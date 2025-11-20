require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const piexif = require('piexifjs');

const app = express();
const PORT = 3000;

// Gemini API 초기화
console.log('🔑 Gemini API Key:', process.env.GEMINI_API_KEY ? '✓ 로드됨' : '✗ 미설정');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 미들웨어 설정
app.use(express.static('public'));
app.use(express.json({ limit: '50mb' }));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.set('view engine', 'ejs');
app.set('views', 'views');

// 업로드 폴더 설정
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer 설정 (파일 업로드)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

// 데이터 저장 경로
const dataFile = path.join(__dirname, 'data', 'travels.json');
const dataDir = path.join(__dirname, 'data');

// data 폴더가 없으면 생성
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// 초기 travels.json 생성
if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, JSON.stringify([], null, 2));
}

// 데이터 읽기
function getTravels() {
    try {
        const data = fs.readFileSync(dataFile, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('데이터 읽기 오류:', err);
        return [];
    }
}

// 데이터 저장
function saveTravels(travels) {
    try {
        fs.writeFileSync(dataFile, JSON.stringify(travels, null, 2));
    } catch (err) {
        console.error('데이터 저장 오류:', err);
    }
}

// 메인 페이지 - 여행 목록
app.get('/', (req, res) => {
    const travels = getTravels();
    res.render('index', { travels });
});

// 여행 추가 페이지
app.get('/add', (req, res) => {
    res.render('add');
});

// 여행 상세 페이지
app.get('/travel/:id', (req, res) => {
    const travels = getTravels();
    const travel = travels.find(t => t.id === req.params.id);
    
    if (!travel) {
        return res.status(404).render('404', { id: req.params.id });
    }
    
    res.render('travel-detail', { travel });
});

// API: 여행 업로드
app.post('/api/upload', upload.array('media', 10), async (req, res) => {
    try {
        const { title, description, latitude, longitude, tags } = req.body;
        const travels = getTravels();
        
        // 파일 처리 및 EXIF 추출
        const uploadedFiles = req.files.map((file, index) => {
            const fileObj = {
                index: index + 1, // 1번부터 시작
                filename: file.filename,
                originalName: file.originalname,
                path: `/uploads/${file.filename}`,
                size: file.size,
                type: file.mimetype
            };

            // 이미지 파일에서 EXIF GPS 추출
            if (file.mimetype.startsWith('image/')) {
                const filePath = path.join(__dirname, 'public', fileObj.path);
                const gpsData = extractGPSFromImage(filePath);
                
                if (gpsData) {
                    fileObj.latitude = gpsData.latitude;
                    fileObj.longitude = gpsData.longitude;
                    console.log(`📍 ${fileObj.index}번 이미지 GPS: ${gpsData.latitude}, ${gpsData.longitude}`);
                }
            }

            return fileObj;
        });

        const newTravel = {
            id: Date.now().toString(),
            title: title || '제목 없음',
            description: description || '',
            latitude: parseFloat(latitude) || null,
            longitude: parseFloat(longitude) || null,
            tags: tags ? tags.split(',').map(t => t.trim()) : [],
            media: uploadedFiles,
            uploadDate: new Date().toLocaleString('ko-KR'),
            createdAt: new Date().toISOString()
        };

        travels.push(newTravel);
        saveTravels(travels);

        res.json({
            success: true,
            message: '여행이 추가되었습니다.',
            travel: newTravel
        });
    } catch (error) {
        console.error('업로드 오류:', error);
        res.status(500).json({
            success: false,
            message: '업로드 중 오류가 발생했습니다.',
            error: error.message
        });
    }
});

// API: AI 제목 생성 (이미지 분석 포함)
app.post('/api/generate-title', async (req, res) => {
    try {
        const { latitude, longitude, photoCount, currentTitle, imageDataList, imageData } = req.body;

        // 좌표 기반 지역 정보 생성
        const locationInfo = getLocationName(latitude, longitude);

        let result;

        // 여러 이미지 데이터 처리 (최우선)
        if (imageDataList && Array.isArray(imageDataList) && imageDataList.length > 0) {
            console.log(`📸 ${imageDataList.length}개 이미지 분석 시작...`);
            
            try {
                const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
                
                // 이미지 데이터 준비
                const imageParts = [];
                imageDataList.forEach((img, idx) => {
                    let mimeType = 'image/jpeg';
                    let base64Data = img.data;
                    
                    const matches = img.data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
                    if (matches) {
                        mimeType = matches[1];
                        base64Data = matches[2];
                    }
                    
                    imageParts.push({
                        inlineData: {
                            mimeType: mimeType,
                            data: base64Data
                        }
                    });
                });

                const prompt = `당신은 여행 일기 작가이면서 이미지 분석 전문가입니다.

제공된 ${imageDataList.length}개의 사진을 모두 분석하고 종합적인 여행 제목을 생성해주세요.

## 분석 요청:
1. 모든 사진의 장소/활동 분석 (공통 요소 찾기)
2. 여행 전체의 활동 유형 감지
3. 여행 전체의 분위기 파악

## 제목 생성 조건:
- 위치: ${locationInfo}
- 사진 수: ${photoCount}장
- 스타일: 감정과 경험이 담긴 제목
- 길이: 18-28자
- 활동 유형과 감정을 반드시 포함

## 응답 (JSON만 출력):
{
  "activityType": "감지된 주요 활동",
  "atmosphere": "분위기/느낌",
  "mainTitle": "감정이 담긴 여행 제목",
  "suggestions": [
    "대체 제목1",
    "대체 제목2", 
    "대체 제목3"
  ]
}`;

                // 모든 이미지와 프롬프트를 함께 전송
                const content = [...imageParts, prompt];
                result = await model.generateContent(content);

                const responseText = result.response.text();
                console.log('📊 Gemini 응답:', responseText.substring(0, 100));

                // JSON 파싱
                const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                
                if (!jsonMatch) {
                    throw new Error('Invalid response format');
                }

                const parsedResult = JSON.parse(jsonMatch[0]);

                res.json({
                    success: true,
                    title: parsedResult.mainTitle || '여행의 기억을 담다',
                    suggestions: parsedResult.suggestions || [],
                    activityType: parsedResult.activityType || '여행',
                    travelTheme: parsedResult.atmosphere || '특별한 경험'
                });
            } catch (err) {
                console.error('❌ 다중 이미지 분석 오류:', err.message);
                throw err;
            }
        }
        // 단일 이미지 데이터 처리
        else if (imageData && imageData.length > 100) {
            console.log('📸 이미지 분석 시작... (크기:', Math.round(imageData.length / 1024), 'KB)');
            
            try {
                // Base64 데이터에서 MIME 타입과 데이터 분리
                let mimeType = 'image/jpeg';
                let base64Data = imageData;
                
                const matches = imageData.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
                if (matches) {
                    mimeType = matches[1];
                    base64Data = matches[2];
                }

                const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

                const prompt = `당신은 여행 일기 작가이면서 이미지 분석 전문가입니다.

사진을 분석하고 감정적이고 매력적인 여행 제목을 생성해주세요.

## 분석 요청:
1. 사진에 보이는 장소/활동 분석 (음식, 건축, 자연, 사람, 활동 등)
2. 여행 활동 유형 감지 (한옥투어, 맛집, 하이킹, 쇼핑, 카페, 자연탐험, 문화유산, 야경감상, 축제 등)
3. 사진의 분위기 파악 (감성, 활동성, 휴식, 모험 등)

## 제목 생성 조건:
- 위치: ${locationInfo}
- 사진 수: ${photoCount}장
- 스타일: 감정과 경험이 담긴 제목 (예: "서울 한옥에서의 전통 문화 체험", "강릉 카페거리에서의 느린 오후")
- 길이: 18-28자
- 활동 유형과 감정을 반드시 포함

## 응답 (JSON만 출력):
{
  "activityType": "감지된 주요 활동",
  "atmosphere": "분위기/느낌",
  "mainTitle": "감정이 담긴 여행 제목",
  "suggestions": [
    "대체 제목1",
    "대체 제목2", 
    "대체 제목3"
  ]
}`;

                result = await model.generateContent([
                    {
                        inlineData: {
                            mimeType: mimeType,
                            data: base64Data
                        }
                    },
                    prompt
                ]);

                const responseText = result.response.text();
                console.log('📊 Gemini 응답 수신:', responseText.substring(0, 100));

                // JSON 파싱
                const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                
                if (!jsonMatch) {
                    throw new Error('Invalid response format from Gemini');
                }

                const parsedResult = JSON.parse(jsonMatch[0]);

                res.json({
                    success: true,
                    title: parsedResult.mainTitle || '여행의 기억을 담다',
                    suggestions: parsedResult.suggestions || [],
                    activityType: parsedResult.activityType || '여행',
                    travelTheme: parsedResult.atmosphere || '특별한 경험'
                });
            } catch (imageError) {
                console.error('이미지 분석 오류, 텍스트 기반 제목 생성으로 폴백:', imageError.message);
                // 이미지 분석 실패시 텍스트 기반으로 폴백
                throw imageError; // 아래의 catch에서 처리
            }
        } else {
            // 이미지 없이 텍스트만으로 제목 생성
            console.log('📝 텍스트 기반 제목 생성...');

            const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
            const textPrompt = `당신은 여행 일기 전문가입니다. 감정적이고 매력적인 여행 제목을 생성해주세요.

## 여행 정보:
- 위치: ${locationInfo}
- 사진/영상: ${photoCount}개
- 사용자 입력 제목: ${currentTitle || '없음'}

## 제목 생성 조건:
- 감정과 경험이 담긴 제목
- 길이: 18-28자
- 위치명 반드시 포함
- 감정 표현 포함
- 예: "서울 명동에서의 설렘 가득한 쇼핑", "부산 해변의 노을 감상", "강릉에서의 여유로운 하루"

## 응답 (JSON만):
{
  "mainTitle": "감정이 담긴 여행 제목",
  "suggestions": [
    "대체 제목1",
    "대체 제목2",
    "대체 제목3"
  ]
}`;

            result = await model.generateContent(textPrompt);
            const responseText = result.response.text();

            console.log('📊 Gemini 응답 수신:', responseText.substring(0, 100));

            // JSON 파싱
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            
            if (!jsonMatch) {
                throw new Error('Invalid response format from Gemini');
            }

            const parsedResult = JSON.parse(jsonMatch[0]);

            res.json({
                success: true,
                title: parsedResult.mainTitle || '여행의 기억을 담다',
                suggestions: parsedResult.suggestions || [],
                activityType: '여행',
                travelTheme: '추억'
            });
        }
    } catch (error) {
        console.error('❌ AI 제목 생성 오류:', error.message);
        
        // 오류 발생시 기본값 반환
        const defaultTitle = generateDefaultTitle(req.body);
        res.json({
            success: true,
            title: defaultTitle,
            suggestions: [
                `${getLocationName(req.body.latitude, req.body.longitude)}에서의 특별한 하루`,
                `${getLocationName(req.body.latitude, req.body.longitude)} 여행 기록`,
                `${getLocationName(req.body.latitude, req.body.longitude)}의 아름다운 순간들`
            ],
            activityType: '여행',
            travelTheme: '기억'
        });
    }
});

// 기본 제목 생성 (API 오류 시)
function generateDefaultTitle(data) {
    const { latitude, longitude, photoCount, currentTitle } = data;
    const location = getLocationName(latitude, longitude);
    
    if (currentTitle && currentTitle.trim()) {
        return currentTitle;
    }

    const templates = [
        `${location}에서의 특별한 날들`,
        `${location}의 매력에 빠지다`,
        `${location} 여행, 잊지 못할 추억`,
        `${location}에서 만나는 설렘`,
        `${location}의 아름다운 순간들`,
        `${location} 여행의 시작`,
        `${location}에서의 새로운 경험`,
        `${location}의 숨겨진 매력`,
        `${location}에서 찾은 행복`,
        `${location} 여행, 마음이 움직이다`
    ];

    return templates[Math.floor(Math.random() * templates.length)];
}

// 좌표 기반 위치명 반환 (간단한 한국 주요 도시 매핑)
function getLocationName(lat, lon) {
    // 주요 도시 좌표 (대략적)
    const cities = {
        '서울': { lat: 37.5665, lon: 126.9780, radius: 0.3 },
        '부산': { lat: 35.1796, lon: 129.0756, radius: 0.3 },
        '대구': { lat: 35.8716, lon: 128.5948, radius: 0.3 },
        '대전': { lat: 36.3504, lon: 127.3845, radius: 0.3 },
        '광주': { lat: 35.1596, lon: 126.8526, radius: 0.3 },
        '인천': { lat: 37.2557, lon: 126.7314, radius: 0.3 },
        '제주': { lat: 33.4996, lon: 126.5312, radius: 0.4 },
        '강원': { lat: 37.2411, lon: 128.5945, radius: 0.5 },
        '경주': { lat: 35.8264, lon: 129.2236, radius: 0.2 },
        '전주': { lat: 35.8242, lon: 127.1477, radius: 0.2 }
    };

    for (const [city, info] of Object.entries(cities)) {
        const distance = Math.sqrt(Math.pow(lat - info.lat, 2) + Math.pow(lon - info.lon, 2));
        if (distance < info.radius) {
            return city;
        }
    }

    return `위도 ${lat.toFixed(2)}, 경도 ${lon.toFixed(2)} 지역`;
}

// EXIF 데이터에서 GPS 좌표 추출
function extractGPSFromImage(filePath) {
    try {
        const imageBuffer = fs.readFileSync(filePath);
        const imageString = imageBuffer.toString('binary');
        
        const exifData = piexif.load(imageString);
        
        if (!exifData.GPS) {
            return null;
        }

        const gpsIfd = exifData.GPS;
        
        // GPS 데이터 추출
        const lat = gpsIfd[piexif.GPSIFD.GPSLatitude];
        const lon = gpsIfd[piexif.GPSIFD.GPSLongitude];
        const latRef = gpsIfd[piexif.GPSIFD.GPSLatitudeRef];
        const lonRef = gpsIfd[piexif.GPSIFD.GPSLongitudeRef];
        
        if (!lat || !lon) {
            return null;
        }

        // DMS를 Decimal로 변환
        const convertDMS = (dms, ref) => {
            const degrees = dms[0][0] / dms[0][1];
            const minutes = dms[1][0] / dms[1][1];
            const seconds = dms[2][0] / dms[2][1];
            
            let decimal = degrees + minutes / 60 + seconds / 3600;
            
            if (ref === 'S' || ref === 'W') {
                decimal *= -1;
            }
            
            return parseFloat(decimal.toFixed(6));
        };

        const latitude = convertDMS(lat, latRef);
        const longitude = convertDMS(lon, lonRef);

        return {
            latitude,
            longitude
        };
    } catch (error) {
        console.error('EXIF 추출 오류:', error.message);
        return null;
    }
}
app.delete('/api/travel/:id', (req, res) => {
    try {
        let travels = getTravels();
        const travelIndex = travels.findIndex(t => t.id === req.params.id);
        
        if (travelIndex === -1) {
            return res.status(404).json({ success: false, message: '여행을 찾을 수 없습니다.' });
        }

        // 파일 삭제
        const travel = travels[travelIndex];
        travel.media.forEach(file => {
            const filePath = path.join(__dirname, 'public', file.path);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        });

        travels.splice(travelIndex, 1);
        saveTravels(travels);

        res.json({ success: true, message: '여행이 삭제되었습니다.' });
    } catch (error) {
        console.error('삭제 오류:', error);
        res.status(500).json({ success: false, message: '삭제 중 오류가 발생했습니다.' });
    }
});

// API: 모든 여행 조회
app.get('/api/travels', (req, res) => {
    const travels = getTravels();
    res.json(travels);
});

// API: 좌표로 지역명 조회 (역지오코딩)
app.post('/api/reverse-geocode', async (req, res) => {
    try {
        const { latitude, longitude } = req.body;

        if (!latitude || !longitude) {
            return res.status(400).json({ success: false, message: '위도, 경도가 필요합니다.' });
        }

        console.log(`🔍 역지오코딩 요청: (${latitude}, ${longitude})`);

        // 1차 시도: 내장 함수로 지역명 조회
        let locationName = getLocationName(latitude, longitude);

        // 2차 시도: 좌표만 반환되는 경우 Gemini API 사용
        if (!locationName || locationName.match(/^[\d\.\,\s]+$/)) {
            console.log('📌 Gemini API로 지역명 조회 중...');
            
            const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
            const prompt = `주어진 좌표의 지역명을 정확하게 알아내세요.

좌표: 위도 ${latitude}, 경도 ${longitude}

응답 (JSON만):
{
  "regionName": "광역도시 또는 지역명 (예: 서울, 부산, 경주, 강릉)",
  "city": "시/군/구 상세명 (있으면)",
  "landmark": "유명한 랜드마크 또는 명소 (있으면)"
}`;

            try {
                const result = await model.generateContent(prompt);
                const responseText = result.response.text();
                const jsonMatch = responseText.match(/\{[\s\S]*\}/);

                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    locationName = parsed.regionName;
                    
                    if (parsed.city) {
                        locationName += ` (${parsed.city})`;
                    }
                    if (parsed.landmark) {
                        locationName += ` - ${parsed.landmark}`;
                    }
                    
                    console.log(`✓ Gemini 조회 성공: ${locationName}`);
                }
            } catch (geminiError) {
                console.error('Gemini 조회 실패:', geminiError.message);
            }
        }

        res.json({
            success: true,
            locationName: locationName || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
            latitude,
            longitude
        });
    } catch (error) {
        console.error('역지오코딩 오류:', error.message);
        res.status(500).json({
            success: false,
            message: '지역명 조회 실패',
            error: error.message
        });
    }
});

// 서버 시작
app.listen(PORT, () => {
    console.log(`🚀 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
    console.log(`📍 브라우저에서 http://localhost:${PORT} 를 열어주세요.`);
});
