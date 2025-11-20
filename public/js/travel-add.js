// 여행 추가 - 단계별 진행 관리
let currentStep = 1;
let map;
let marker;
let selectedLocation = null;
let uploadedPhotos = [];

// Step 1: 지도 초기화
function initMap() {
    const mapDiv = document.getElementById('map');
    const mapOptions = {
        center: new naver.maps.LatLng(37.5665, 126.9780), // 서울 중심
        zoom: 12
    };
    map = new naver.maps.Map(mapDiv, mapOptions);

    // 지도 클릭 시 위치 선택
    naver.maps.Event.addListener(map, 'click', function(e) {
        const latlng = e.coord;
        
        selectedLocation = {
            latitude: latlng.lat(),
            longitude: latlng.lng()
        };

        // 입력 필드에 값 할당
        document.getElementById('latitude').value = latlng.lat().toFixed(4);
        document.getElementById('longitude').value = latlng.lng().toFixed(4);

        // 기존 마커 제거
        if (marker) {
            marker.setMap(null);
        }

        // 새 마커 생성
        marker = new naver.maps.Marker({
            position: latlng,
            map: map,
            title: '여행지 위치',
            icon: {
                url: 'https://maps.google.com/mapfiles/ms/icons/red-dot.png',
                size: new naver.maps.Size(40, 40),
                scaledSize: new naver.maps.Size(40, 40)
            }
        });

        // 위치 정보 표시
        updateLocationDisplay();

        // Step 1 다음 버튼 활성화
        document.getElementById('step1Next').disabled = false;

        console.log(`📍 위치 선택됨: ${latlng.lat().toFixed(4)}, ${latlng.lng().toFixed(4)}`);
    });
}

function updateLocationDisplay() {
    const lat = document.getElementById('latitude').value;
    const lon = document.getElementById('longitude').value;
    
    if (lat && lon) {
        document.getElementById('locationDisplay').innerHTML = `
            📍 위도: ${lat}<br>
            📍 경도: ${lon}
        `;
    }
}

// DMS (도, 분, 초) 형식을 10진수로 변환
function convertDMSToDecimal(dms, ref) {
    if (!dms || !dms[0] || !dms[1] || !dms[2]) {
        return null;
    }

    const degrees = dms[0];
    const minutes = dms[1];
    const seconds = dms[2];

    let decimal = degrees + minutes / 60 + seconds / 3600;

    if (ref === 'S' || ref === 'W') {
        decimal *= -1;
    }

    return decimal;
}

// EXIF 데이터에서 GPS 좌표 추출
function extractGPSFromImage(imgElement) {
    return new Promise((resolve) => {
        if (typeof EXIF === 'undefined') {
            console.warn('⚠ EXIF 라이브러리가 로드되지 않았습니다.');
            resolve(null);
            return;
        }

        EXIF.getData(imgElement, function() {
            try {
                const allMetaData = EXIF.getAllTags(this);
                
                if (!allMetaData.GPSLatitude || !allMetaData.GPSLongitude) {
                    resolve(null);
                    return;
                }

                const latitude = convertDMSToDecimal(allMetaData.GPSLatitude, allMetaData.GPSLatitudeRef);
                const longitude = convertDMSToDecimal(allMetaData.GPSLongitude, allMetaData.GPSLongitudeRef);

                if (latitude !== null && longitude !== null) {
                    resolve({
                        latitude,
                        longitude,
                        make: allMetaData.Make || '정보 없음',
                        model: allMetaData.Model || '정보 없음',
                        dateTime: allMetaData.DateTime || '정보 없음'
                    });
                } else {
                    resolve(null);
                }
            } catch (error) {
                console.error('EXIF 처리 중 오류:', error);
                resolve(null);
            }
        });
    });
}

// Step 2: 파일 미리보기 및 EXIF 추출
document.getElementById('media').addEventListener('change', async function(e) {
    const preview = document.getElementById('filePreview');
    preview.innerHTML = '';
    uploadedPhotos = [];

    const files = Array.from(this.files);
    
    for (const file of files) {
        const item = document.createElement('div');
        item.className = 'preview-item';

        const reader = new FileReader();
        reader.onload = async function(event) {
            if (file.type.startsWith('image/')) {
                item.innerHTML = `<img src="${event.target.result}" alt="${file.name}">`;
                
                uploadedPhotos.push({
                    name: file.name,
                    type: file.type,
                    dataUrl: event.target.result
                });

                // 첫 번째 이미지에서 EXIF 데이터 추출
                if (files.indexOf(file) === 0) {
                    const img = new Image();
                    img.onload = async function() {
                        const gpsData = await extractGPSFromImage(this);
                        
                        if (gpsData) {
                            console.log(`✓ GPS 정보 감지: (${gpsData.latitude.toFixed(4)}, ${gpsData.longitude.toFixed(4)})`);
                        }
                    };
                    img.src = event.target.result;
                }
            } else if (file.type.startsWith('video/')) {
                item.innerHTML = `<video controls style="width:100%; height:100%; object-fit:cover;"><source src="${event.target.result}"></video>`;
                uploadedPhotos.push({
                    name: file.name,
                    type: file.type,
                    dataUrl: event.target.result
                });
            }
        };
        reader.readAsDataURL(file);

        preview.appendChild(item);
    }

    // Step 2 다음 버튼 활성화
    if (files.length > 0) {
        document.getElementById('step2Next').disabled = false;
    }
});

// 드래그 & 드롭
const fileWrapper = document.querySelector('.file-input-wrapper');

fileWrapper.addEventListener('dragover', (e) => {
    e.preventDefault();
    fileWrapper.style.backgroundColor = '#f0f0f0';
});

fileWrapper.addEventListener('dragleave', () => {
    fileWrapper.style.backgroundColor = '';
});

fileWrapper.addEventListener('drop', (e) => {
    e.preventDefault();
    fileWrapper.style.backgroundColor = '';
    document.getElementById('media').files = e.dataTransfer.files;
    
    const event = new Event('change', { bubbles: true });
    document.getElementById('media').dispatchEvent(event);
});

// 좌표로 지역명 조회
async function getLocationNameFromCoords(lat, lon) {
    try {
        const response = await fetch('/api/reverse-geocode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ latitude: lat, longitude: lon })
        });
        const result = await response.json();
        return result.locationName || null;
    } catch (error) {
        console.error('역지오코딩 오류:', error);
        return null;
    }
}

// Step 3: AI 제목 생성
async function generateAITitle(isRegenerate = false) {
    const location = selectedLocation;
    const title = document.getElementById('title').value;
    const loading = document.getElementById('aiLoading');
    const suggestions = document.getElementById('aiSuggestions');

    if (!location || uploadedPhotos.length === 0) {
        alert('위치와 사진을 모두 선택해주세요.');
        return;
    }

    loading.style.display = 'inline-block';
    
    // 새로 생성하기의 경우 기존 제목 초기화
    if (isRegenerate) {
        document.getElementById('title').value = '';
    }

    try {
        // 모든 이미지 압축하여 전송 (각 최대 300KB)
        const compressedImages = [];
        
        for (let i = 0; i < uploadedPhotos.length; i++) {
            const compressed = await compressImage(uploadedPhotos[i].dataUrl, 300);
            compressedImages.push({
                index: i + 1,
                data: compressed
            });
            console.log(`✓ ${i + 1}번 이미지 압축 완료`);
        }

        // 백엔드로 AI 제목 생성 요청
        const response = await fetch('/api/generate-title', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                latitude: location.latitude,
                longitude: location.longitude,
                photoCount: uploadedPhotos.length,
                currentTitle: title,
                imageDataList: compressedImages  // 모든 압축된 이미지 데이터
            })
        });

        const result = await response.json();

        loading.style.display = 'none';

        if (result.success) {
            // 좌표만 표시되는 경우 지역명 조회
            let displayLocation = result.locationName || null;
            if (!displayLocation) {
                displayLocation = await getLocationNameFromCoords(location.latitude, location.longitude);
            }
            
            // 위치 표시 업데이트
            if (displayLocation) {
                document.getElementById('locationDisplay').innerHTML = `
                    📍 ${displayLocation}<br>
                    <small style="color: #999;">${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}</small>
                `;
            }

            // 주 제목 설정
            document.getElementById('title').value = result.title;

            // 추천 제목 표시
            if (result.suggestions && result.suggestions.length > 0) {
                suggestions.innerHTML = '<strong style="color: #ff6f00;">추천 제목:</strong>';
                result.suggestions.forEach(suggestion => {
                    const btn = document.createElement('button');
                    btn.className = 'suggestion-btn';
                    btn.textContent = suggestion;
                    btn.onclick = (e) => {
                        e.preventDefault();
                        document.getElementById('title').value = suggestion;
                    };
                    suggestions.appendChild(btn);
                });
                suggestions.style.display = 'block';
            }

            // 활동 정보 표시
            if (result.activityType) {
                let activityDiv = document.getElementById('activityInfo');
                if (!activityDiv) {
                    activityDiv = document.createElement('div');
                    activityDiv.id = 'activityInfo';
                    suggestions.parentElement.appendChild(activityDiv);
                }
                activityDiv.style.cssText = 'margin-top: 15px; padding: 10px; background-color: #e8f5e9; border-radius: 4px; font-size: 13px; color: #2e7d32;';
                activityDiv.innerHTML = `<strong>🎯 감지된 활동:</strong> ${result.activityType}<br><strong>📌 여행 주제:</strong> ${result.travelTheme}`;
            }

            console.log('✓ AI 제목 생성 완료', result);
        } else {
            alert('제목 생성 실패: ' + result.message);
        }
    } catch (error) {
        loading.style.display = 'none';
        console.error('AI 제목 생성 오류:', error);
        alert('제목 생성 중 오류가 발생했습니다.');
    }
}

// 이미지 압축 함수
function compressImage(dataUrl, maxSize) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;
            
            // 너비를 최대 800px로 제한
            if (width > 800) {
                height = (height * 800) / width;
                width = 800;
            }

            canvas.width = width;
            canvas.height = height;
            
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            // 품질 조정하며 반복
            let quality = 0.8;
            let compressedData = canvas.toDataURL('image/jpeg', quality);

            while (compressedData.length > maxSize * 1024 && quality > 0.3) {
                quality -= 0.1;
                compressedData = canvas.toDataURL('image/jpeg', quality);
            }

            resolve(compressedData);
        };
        img.src = dataUrl;
    });
}

// Step 네비게이션
function goToStep(stepNumber) {
    // 현재 스텝 숨기기
    document.getElementById(`step${currentStep}`).classList.remove('active');
    
    // 새로운 스텝 표시
    document.getElementById(`step${stepNumber}`).classList.add('active');
    currentStep = stepNumber;

    // 스텝 인디케이터 업데이트
    updateStepIndicator();

    // Step 4에서 요약 정보 표시
    if (stepNumber === 4) {
        displaySummary();
    }

    // 페이지 맨 위로 스크롤
    window.scrollTo(0, 0);
}

function updateStepIndicator() {
    document.querySelectorAll('.step').forEach(step => {
        const stepNum = parseInt(step.dataset.step);
        step.classList.remove('active', 'completed');

        if (stepNum < currentStep) {
            step.classList.add('completed');
        } else if (stepNum === currentStep) {
            step.classList.add('active');
        }
    });
}

function displaySummary() {
    const lat = document.getElementById('latitude').value;
    const lon = document.getElementById('longitude').value;
    const title = document.getElementById('title').value;
    const description = document.getElementById('description').value;
    const tags = document.getElementById('tags').value;

    document.getElementById('summaryInfo').innerHTML = `
        <h3>📋 여행 정보 확인</h3>
        <table style="width: 100%; border-collapse: collapse;">
            <tr style="border-bottom: 1px solid #ddd;">
                <td style="padding: 10px; font-weight: bold; width: 30%;">제목</td>
                <td style="padding: 10px;">${title}</td>
            </tr>
            <tr style="border-bottom: 1px solid #ddd;">
                <td style="padding: 10px; font-weight: bold;">위치</td>
                <td style="padding: 10px;">📍 ${lat}, ${lon}</td>
            </tr>
            <tr style="border-bottom: 1px solid #ddd;">
                <td style="padding: 10px; font-weight: bold;">사진 수</td>
                <td style="padding: 10px;">🎬 ${uploadedPhotos.length}개</td>
            </tr>
            <tr style="border-bottom: 1px solid #ddd;">
                <td style="padding: 10px; font-weight: bold;">설명</td>
                <td style="padding: 10px;">${description || '(없음)'}</td>
            </tr>
            <tr>
                <td style="padding: 10px; font-weight: bold;">태그</td>
                <td style="padding: 10px;">${tags || '(없음)'}</td>
            </tr>
        </table>
    `;
}

// 폼 제출
document.getElementById('travelForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    const formData = new FormData();
    
    // Step 1: 위치
    formData.append('latitude', document.getElementById('latitude').value);
    formData.append('longitude', document.getElementById('longitude').value);
    
    // Step 2: 파일
    const mediaInput = document.getElementById('media');
    for (let file of mediaInput.files) {
        formData.append('media', file);
    }
    
    // Step 3: 메타데이터
    formData.append('title', document.getElementById('title').value);
    formData.append('description', document.getElementById('description').value);
    formData.append('tags', document.getElementById('tags').value);

    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (result.success) {
            alert('✓ 여행이 저장되었습니다!');
            window.location.href = `/travel/${result.travel.id}`;
        } else {
            alert('✗ 저장 실패: ' + result.message);
        }
    } catch (error) {
        console.error('저장 오류:', error);
        alert('✗ 저장 중 오류가 발생했습니다.');
    }
});

// 페이지 로드 시 지도 초기화
document.addEventListener('DOMContentLoaded', () => {
    // Step 1 초기 상태: 위치 선택 필요
    document.querySelector('[data-step="1"]').classList.add('active');
    document.getElementById('step1').classList.add('active');
    
    initMap();
});
