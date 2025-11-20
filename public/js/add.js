// 네이버 지도 초기화
let map;
let marker;
let extractedGPSData = {}; // EXIF에서 추출한 GPS 데이터 저장

function initMap() {
    const mapDiv = document.getElementById('map');
    const mapOptions = {
        center: new naver.maps.LatLng(37.3595704, 127.105399), // 서울 기본값
        zoom: 12
    };
    map = new naver.maps.Map(mapDiv, mapOptions);

    // 지도 클릭 시 위치 선택
    naver.maps.Event.addListener(map, 'click', function(e) {
        const latlng = e.coord;
        
        // 위도, 경도 입력 필드에 값 할당
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
            title: '선택된 위치',
            icon: {
                url: 'https://maps.google.com/mapfiles/ms/icons/red-dot.png',
                size: new naver.maps.Size(32, 32),
                scaledSize: new naver.maps.Size(32, 32)
            }
        });

        console.log(`📍 위치 선택됨: ${latlng.lat().toFixed(4)}, ${latlng.lng().toFixed(4)}`);
    });
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
                console.log('📋 EXIF 데이터:', allMetaData);
                
                // GPS 데이터 확인
                if (!allMetaData.GPSLatitude || !allMetaData.GPSLongitude) {
                    console.log('ℹ 이 이미지에는 GPS 정보가 없습니다.');
                    resolve(null);
                    return;
                }

                const latitude = convertDMSToDecimal(allMetaData.GPSLatitude, allMetaData.GPSLatitudeRef);
                const longitude = convertDMSToDecimal(allMetaData.GPSLongitude, allMetaData.GPSLongitudeRef);

                if (latitude !== null && longitude !== null) {
                    const gpsData = {
                        latitude: latitude,
                        longitude: longitude,
                        make: allMetaData.Make || '정보 없음',
                        model: allMetaData.Model || '정보 없음',
                        dateTime: allMetaData.DateTime || '정보 없음'
                    };
                    console.log(`✓ GPS 정보 감지: (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`);
                    console.log(`📱 촬영기기: ${gpsData.make} ${gpsData.model}`);
                    console.log(`📅 촬영시간: ${gpsData.dateTime}`);
                    resolve(gpsData);
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

// 파일 미리보기 및 EXIF 추출
document.getElementById('media').addEventListener('change', async function(e) {
    const preview = document.getElementById('filePreview');
    preview.innerHTML = '';

    const files = Array.from(this.files);
    
    for (const file of files) {
        const item = document.createElement('div');
        item.className = 'preview-item';

        const reader = new FileReader();
        reader.onload = async function(event) {
            if (file.type.startsWith('image/')) {
                item.innerHTML = `<img src="${event.target.result}" alt="${file.name}">`;
                
                // 첫 번째 이미지에서 EXIF 데이터 추출
                if (files.indexOf(file) === 0) {
                    const img = new Image();
                    img.onload = async function() {
                        const gpsData = await extractGPSFromImage(this);
                        
                        if (gpsData) {
                            // 좌표 입력란에 자동 채우기
                            document.getElementById('latitude').value = gpsData.latitude.toFixed(4);
                            document.getElementById('longitude').value = gpsData.longitude.toFixed(4);

                            // 지도 중심 이동
                            const newPosition = new naver.maps.LatLng(gpsData.latitude, gpsData.longitude);
                            map.setCenter(newPosition);
                            map.setZoom(14);

                            // 마커 생성
                            if (marker) {
                                marker.setMap(null);
                            }
                            marker = new naver.maps.Marker({
                                position: newPosition,
                                map: map,
                                title: '추출된 위치',
                                icon: {
                                    url: 'https://maps.google.com/mapfiles/ms/icons/green-dot.png',
                                    size: new naver.maps.Size(32, 32),
                                    scaledSize: new naver.maps.Size(32, 32)
                                }
                            });

                            // 화면에 EXIF 정보 표시
                            showExifInfo(gpsData, file.name);
                        }
                    };
                    img.src = event.target.result;
                }
            } else if (file.type.startsWith('video/')) {
                item.innerHTML = `<video controls style="width:100%; height:100%; object-fit:cover;"><source src="${event.target.result}"></video>`;
            }
        };
        reader.readAsDataURL(file);

        preview.appendChild(item);
    }
});

// EXIF 정보를 화면에 표시
function showExifInfo(gpsData, fileName) {
    const infoDiv = document.getElementById('exifInfo');
    
    if (!infoDiv) {
        const newInfoDiv = document.createElement('div');
        newInfoDiv.id = 'exifInfo';
        newInfoDiv.style.cssText = `
            margin-top: 15px;
            padding: 15px;
            background-color: #f0f8f0;
            border-left: 4px solid #4CAF50;
            border-radius: 4px;
            font-size: 13px;
            color: #2e7d32;
        `;
        document.querySelector('.file-preview').parentElement.appendChild(newInfoDiv);
    }

    document.getElementById('exifInfo').innerHTML = `
        <strong>✓ GPS 정보 추출됨</strong><br>
        📁 파일: ${fileName}<br>
        📍 위도: ${gpsData.latitude.toFixed(4)}<br>
        📍 경도: ${gpsData.longitude.toFixed(4)}<br>
        📱 기기: ${gpsData.make} ${gpsData.model}<br>
        📅 촬영시간: ${gpsData.dateTime}
    `;
}

// 드래그 & 드롭
const fileInput = document.getElementById('media');
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
    
    // change 이벤트 발생시켜 EXIF 추출 실행
    const event = new Event('change', { bubbles: true });
    document.getElementById('media').dispatchEvent(event);
});

// 폼 제출
document.getElementById('uploadForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    const formData = new FormData(this);

    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (result.success) {
            alert('✓ 여행이 추가되었습니다!');
            window.location.href = `/travel/${result.travel.id}`;
        } else {
            alert('✗ 업로드 실패: ' + result.message);
        }
    } catch (error) {
        console.error('업로드 오류:', error);
        alert('✗ 업로드 중 오류가 발생했습니다.');
    }
});

// 페이지 로드 시 지도 초기화
document.addEventListener('DOMContentLoaded', initMap);
