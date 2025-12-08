// --- הגדרת משתנים גלובליים ---
const video = document.getElementById('videoElement');
const canvasOutput = document.getElementById('canvasOutput');
const scanButton = document.getElementById('scanButton');
// הוספת הארגומנט willReadFrequently לשיפור הביצועים בלולאת הוידאו
const context = canvasOutput.getContext('2d', { willReadFrequently: true });
const videoContainer = document.querySelector('.video-container');

let streaming = false;
let isDocumentFound = false; // משתנה מעקב האם המסמך נראה ונמצא בתוך המסגרת
let currentSrc = null; // משתנה Mat שיכיל את התמונה הנוכחית מהווידאו

// --- הגדרות המסגרת (ROI - Region of Interest) ---
// *** עדכון: תואם ל-CSS החדש (left: 25%) ***
const FRAME_START_X_PCT = 0.25; 
const FRAME_START_Y_PCT = 0.05; 
// *** עדכון: הורדנו את הסף ל-4000 (יותר סלחני) ***
const MIN_DOCUMENT_AREA = 4000; 
// *** עדכון: הגברנו את דיוק הקירוב ל-0.05 (מאוד סלחני לרעש/קימוטים) ***
const APPROX_PRECISION = 0.05; 

// --- פונקציה המופעלת כאשר OpenCV.js נטען ---
function onOpenCvReady() {
    console.log("OpenCV.js נטען בהצלחה.");
    scanButton.disabled = true; 
    scanButton.textContent = "מקם מסמך במסגרת...";

    // פונקציית עזר להפעלת המצלמה עם FacingMode
    function startCamera(facingMode) {
        const constraints = { 
            video: { 
                // שימוש במצלמה האחורית
                facingMode: facingMode 
            }
        };

        navigator.mediaDevices.getUserMedia(constraints)
            .then(function (stream) {
                video.srcObject = stream;
                video.play();
                
                video.addEventListener('canplay', function(ev){
                    if (!streaming) {
                        canvasOutput.width = video.videoWidth;
                        canvasOutput.height = video.videoHeight;
                        streaming = true;
                        requestAnimationFrame(processVideoTick); 
                    }
                }, false);
            })
            .catch(function (err) {
                console.error("שגיאת מצלמה עם facingMode: " + facingMode, err);
                
                if (facingMode === 'environment') {
                    console.log("נסיון מעבר למצלמה קדמית/ברירת מחדל...");
                    // Fallback: נסיון חוזר עם מצב ברירת מחדל (קדמית/אחורית רגיל)
                    startCamera(true); 
                } else {
                    scanButton.textContent = "❌ שגיאה: המצלמה נכשלה לחלוטין.";
                    console.error("המצלמה נכשלה לחלוטין.");
                }
            });
    }

    // נסה קודם להפעיל את המצלמה האחורית (environment)
    if (navigator.mediaDevices.getUserMedia) {
        startCamera('environment'); 
    }
    
    // הגדרת כפתור הצילום - מופעל רק כשהמסמך נמצא
    scanButton.onclick = function() {
        if (!isDocumentFound) return;
        
        streaming = false;
        videoContainer.style.display = 'none';
        canvasOutput.style.display = 'block';
        scanButton.textContent = "עיבוד הסריקה הושלם";
        
        processImageFinal(currentSrc);
    };
}


// --- לולאת עיבוד וידאו בזמן אמת ---
function processVideoTick() {
    if (!streaming) return;

    try {
        context.drawImage(video, 0, 0, canvasOutput.width, canvasOutput.height);
        
        if (currentSrc) currentSrc.delete();
        currentSrc = cv.imread(canvasOutput);
        
        let found = checkDocumentBounds(currentSrc); 
        
        if (found) {
            if (!isDocumentFound) {
                scanButton.disabled = false;
                scanButton.textContent = "✅ צלם וסרוק!";
                isDocumentFound = true;
            }
        } else {
             if (isDocumentFound || scanButton.textContent === "✅ צלם וסרוק!") {
                scanButton.disabled = true;
                scanButton.textContent = "מקם מסמך במסגרת...";
                isDocumentFound = false;
            }
        }
        
    } catch (e) {
        // console.error("שגיאה בלולאת העיבוד:", e);
    }
    
    requestAnimationFrame(processVideoTick); 
}


// --- פונקציה לחישוב פינות המסמך ובדיקה אם הן בתוך המסגרת ---
function checkDocumentBounds(src) {
    let gray = new cv.Mat();
    let blur = new cv.Mat();
    let canny = new cv.Mat();
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();
    let maxContour = null;

    // 1. עיבוד ראשוני
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0, 0);
    cv.Canny(blur, canny, 75, 200, 3, false);
    cv.findContours(canny, contours, hierarchy, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);

    // 2. חיפוש המתאר הגדול ביותר
    let maxArea = 0;
    for (let i = 0; i < contours.size(); ++i) {
        let contour = contours.get(i);
        let area = cv.contourArea(contour);
        
        if (area > MIN_DOCUMENT_AREA) { 
            if (area > maxArea) {
                maxArea = area;
                maxContour = contour;
            }
        }
    }
    
    if (!maxContour) {
        gray.delete(); blur.delete(); canny.delete(); contours.delete(); hierarchy.delete();
        return false;
    }

    // 3. קירוב ומציאת 4 הפינות
    let approx = new cv.Mat();
    let perimeter = cv.arcLength(maxContour, true);
    cv.approxPolyDP(maxContour, approx, APPROX_PRECISION * perimeter, true); 

    let isDocumentValid = false;

    // 4. ודא שמצאנו 4 פינות
    if (approx.rows === 4) {
        let cornerPoints = [];
        for (let i = 0; i < approx.rows; i++) {
            cornerPoints.push({ x: approx.data32S[i * 2], y: approx.data32S[i * 2 + 1] });
        }
        
        // 5. בדיקת גבולות המסגרת האדומה (ROI)
        const frameXStart = src.cols * FRAME_START_X_PCT; 
        const frameYStart = src.rows * FRAME_START_Y_PCT;
        const frameXEnd = src.cols * (1 - FRAME_START_X_PCT); 
        const frameYEnd = src.rows * (1 - FRAME_START_Y_PCT); 

        // בדיקה: האם כל 4 הפינות נמצאות בתוך גבולות המסגרת?
        let allInBounds = cornerPoints.every(p => 
            p.x > frameXStart && p.x < frameXEnd &&
            p.y > frameYStart && p.y < frameYEnd
        );

        isDocumentValid = allInBounds;
    }
    
    // 6. שחרור זיכרון
    gray.delete(); blur.delete(); canny.delete(); contours.delete(); hierarchy.delete();
    if (maxContour) maxContour.delete();
    if (approx) approx.delete();

    return isDocumentValid;
}


// --- פונקציית העיבוד הסופי (Warp Perspective) ---
function processImageFinal(src) {
    if (!src) return;
    
    let gray = new cv.Mat();
    let blur = new cv.Mat();
    let canny = new cv.Mat();
    
    // 1. הכנה ועיבוד ראשוני
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0); 
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0, 0); 
    cv.Canny(blur, canny, 75, 200, 3, false); 

    // 2. מציאת המתארים וחיפוש המתאר הגדול ביותר
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();
    cv.findContours(canny, contours, hierarchy, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);

    let maxArea = 0;
    let maxContour = null;

    for (let i = 0; i < contours.size(); ++i) {
        let contour = contours.get(i);
        let area = cv.contourArea(contour);
        
        if (area > MIN_DOCUMENT_AREA) { 
            if (area > maxArea) {
                maxArea = area;
                maxContour = contour;
            }
        }
        
    }

    if (!maxContour) {
        cv.imshow('canvasOutput', src); 
        src.delete(); gray.delete(); blur.delete(); canny.delete(); contours.delete(); hierarchy.delete();
        return;
    }
    
    // 3. קירוב ומציאת 4 הפינות
    let approx = new cv.Mat();
    let perimeter = cv.arcLength(maxContour, true); 
    cv.approxPolyDP(maxContour, approx, APPROX_PRECISION * perimeter, true); 

    if (approx.rows !== 4) {
        cv.imshow('canvasOutput', src); 
        approx.delete();
        src.delete(); gray.delete(); blur.delete(); canny.delete(); contours.delete(); hierarchy.delete();
        return;
    }

    // 4. מיון הפינות
    let cornerPoints = [];
    for (let i = 0; i < approx.rows; i++) {
        cornerPoints.push({ x: approx.data32S[i * 2], y: approx.data32S[i * 2 + 1] });
    }

    function orderPoints(pts) {
        let sum = pts.map(p => p.x + p.y);
        let diff = pts.map(p => p.x - p.y);
        
        let tl = pts[sum.indexOf(Math.min(...sum))]; 
        let br = pts[sum.indexOf(Math.max(...sum))]; 
        let tr = pts[diff.indexOf(Math.min(...diff))]; 
        let bl = pts[diff.indexOf(Math.max(...diff))]; 

        return [tl, tr, br, bl]; 
    }
    
    let ordered_pts = orderPoints(cornerPoints);
    
    // 5. הגדרת מידות הפלט (יעד)
    let w1 = Math.sqrt(Math.pow(ordered_pts[2].x - ordered_pts[3].x, 2) + Math.pow(ordered_pts[2].y - ordered_pts[3].y, 2));
    let w2 = Math.sqrt(Math.pow(ordered_pts[1].x - ordered_pts[0].x, 2) + Math.pow(ordered_pts[1].y - ordered_pts[0].y, 2));
    let maxWidth = Math.max(w1, w2);

    let h1 = Math.sqrt(Math.pow(ordered_pts[1].x - ordered_pts[2].x, 2) + Math.pow(ordered_pts[1].y - ordered_pts[2].y, 2));
    let h2 = Math.sqrt(Math.pow(ordered_pts[0].x - ordered_pts[3].x, 2) + Math.pow(ordered_pts[0].y - ordered_pts[3].y, 2));
    let maxHeight = Math.max(h1, h2);
    
    let destPoints = [
        0, 0, 
        maxWidth - 1, 0, 
        maxWidth - 1, maxHeight - 1, 
        0, maxHeight - 1 
    ];

    let srcPointsMat = cv.matFromArray(4, 1, cv.CV_32FC2, [
        ordered_pts[0].x, ordered_pts[0].y,
        ordered_pts[1].x, ordered_pts[1].y,
        ordered_pts[2].x, ordered_pts[2].y,
        ordered_pts[3].x, ordered_pts[3].y
    ]);
    
    let destPointsMat = cv.matFromArray(4, 1, cv.CV_32FC2, destPoints);
    
    // 6. יצירת מטריצת הטרנספורמציה (המפה)
    let M = cv.getPerspectiveTransform(srcPointsMat, destPointsMat);
    
    // 7. יישום הטרנספורמציה (Perspective Warp)
    let finalDst = new cv.Mat();
    let dsize = new cv.Size(maxWidth, maxHeight);
    
    cv.warpPerspective(src, finalDst, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

    // 8. שיפור איכות סופי (המרה לשחור-לבן קלאסי)
    let finalGray = new cv.Mat();
    cv.cvtColor(finalDst, finalGray, cv.COLOR_RGBA2GRAY, 0);
    // הוספת סף אדפטיבי לאיכות סריקה מעולה
    cv.adaptiveThreshold(finalGray, finalGray, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 11, 2);


    // 9. הצגת התוצאה הסופית בקנבס
    cv.imshow('canvasOutput', finalGray);
    
    // 10. שחרור זיכרון (חובה!)
    gray.delete(); blur.delete(); canny.delete(); 
    contours.delete(); hierarchy.delete(); approx.delete();
    srcPointsMat.delete(); destPointsMat.delete(); M.delete();
    finalDst.delete(); finalGray.delete();
    
    console.log("עיבוד תמונה הושלם. בוצע תיקון פרספקטיבה ושיפור איכות.");
}
