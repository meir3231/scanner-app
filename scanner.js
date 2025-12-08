// --- הגדרת משתנים גלובליים ---
const video = document.getElementById('videoElement');
const canvasOutput = document.getElementById('canvasOutput');
const scanButton = document.getElementById('scanButton');
const context = canvasOutput.getContext('2d');
const videoContainer = document.querySelector('.video-container');

let streaming = false;
let isDocumentFound = false; // משתנה מעקב חדש
let currentSrc = null; // משתנה Mat שיכיל את התמונה הנוכחית מהווידאו

// --- הגדרות המסגרת (ROI - Region of Interest) ---
// אנו מגדירים את המסגרת האדומה שלנו כאזור החיתוך
// הערכים הללו תואמים ל-10% רווח מכל צד שקבענו ב-CSS
// --- הגדרות המסגרת (ROI - Region of Interest) ---
// הערכים הללו תואמים להגדרות ה-CSS החדשות!
const FRAME_START_X_PCT = 0.20; // 20% מהקצה השמאלי
const FRAME_START_Y_PCT = 0.05; // 5% מהקצה העליון

// --- פונקציה המופעלת כאשר OpenCV.js נטען ---
function onOpenCvReady() {
    console.log("OpenCV.js נטען בהצלחה.");
    scanButton.disabled = true; // חוסמים את הכפתור בהתחלה
    scanButton.textContent = "מקם מסמך במסגרת...";

    if (navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia({ video: true })
            .then(function (stream) {
                video.srcObject = stream;
                video.play();
                video.addEventListener('canplay', function(ev){
                    if (!streaming) {
                        canvasOutput.width = video.videoWidth;
                        canvasOutput.height = video.videoHeight;
                        streaming = true;
                        // הפעלת לולאת ה-Tick לעיבוד בזמן אמת
                        setTimeout(processVideoTick, 100); 
                    }
                }, false);
            })
            .catch(function (err) {
                console.error("שגיאת מצלמה: " + err);
            });
    }

    // הגדרת כפתור הצילום - מופעל רק כשהמסמך נמצא
    scanButton.onclick = function() {
        if (!isDocumentFound) return;
        
        // עצירת הלולאה כדי לצלם פריים סטטי
        stopVideoProcessing();

        // הסתר את הוידאו והצג את הקנבס המעובד
        videoContainer.style.display = 'none';
        canvasOutput.style.display = 'block';
        scanButton.textContent = "עיבוד הסריקה הושלם";
        
        // בצע עיבוד תמונה של OpenCV על הפריים האחרון
        // currentSrc מכיל את התמונה הסטטית האחרונה שצולמה
        processImageFinal(currentSrc);
    };
}


// --- לולאת עיבוד וידאו בזמן אמת ---
function processVideoTick() {
    if (!streaming) return;

    try {
        // צייר את הפריים הנוכחי מהווידאו לקנבס
        context.drawImage(video, 0, 0, canvasOutput.width, canvasOutput.height);
        
        // קרא את התמונה מהקנבס למטריצה (Mat) של OpenCV
        if (currentSrc) currentSrc.delete();
        currentSrc = cv.imread(canvasOutput);
        
        // בדיקת תקינות: האם המסמך נמצא בתוך המסגרת?
        let found = checkDocumentBounds(currentSrc); 
        
        if (found) {
            if (!isDocumentFound) {
                scanButton.disabled = false;
                scanButton.textContent = "✅ צלם וסרוק!";
                isDocumentFound = true;
            }
        } else {
             if (isDocumentFound) {
                scanButton.disabled = true;
                scanButton.textContent = "מקם מסמך במסגרת...";
                isDocumentFound = false;
            }
        }
        
    } catch (e) {
        console.error("שגיאה בלולאת העיבוד:", e);
    }
    
    // קריאה חוזרת לפונקציה לאחר 30 מילישניות (כ-30 פריימים/שנייה)
    requestAnimationFrame(processVideoTick); 
}

function stopVideoProcessing() {
    streaming = false;
}


// --- פונקציה לחישוב פינות המסמך ובדיקה אם הן בתוך המסגרת ---
function checkDocumentBounds(src) {
    let gray = new cv.Mat();
    let blur = new cv.Mat();
    let canny = new cv.Mat();
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();
    let maxContour = null;

    // עיבוד ראשוני
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0, 0);
    cv.Canny(blur, canny, 75, 200, 3, false);
    cv.findContours(canny, contours, hierarchy, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);

    // חיפוש המתאר הגדול ביותר
    let maxArea = 0;
        for (let i = 0; i < contours.size(); ++i) {
            let contour = contours.get(i);
            let area = cv.contourArea(contour);
            
            // **שינוי כאן:** הגדלנו את סף השטח - מומלץ להתחיל עם 10000 
            if (area > 5000) { 
                if (area > maxArea) {
                    maxArea = area;
                    maxContour = contour;
                }
            }
        }
    
    // אם לא נמצא מתאר גדול, שחרר זיכרון וצא
    if (!maxContour) {
        gray.delete(); blur.delete(); canny.delete(); contours.delete(); hierarchy.delete();
        return false;
    }

// 5. קירוב ומציאת 4 הפינות
    let approx = new cv.Mat();
    let perimeter = cv.arcLength(maxContour, true);
    
    // שינוי: חזרה לדיוק סלחני יותר (0.04) כדי למנוע נעילה על מסמכים מעט מקומטים.
    cv.approxPolyDP(maxContour, approx, 0.04 * perimeter, true);

        let isDocumentValid = false;

    // ודא שמצאנו 4 פינות
    if (approx.rows === 4) {
        let cornerPoints = [];
        for (let i = 0; i < approx.rows; i++) {
            cornerPoints.push({ x: approx.data32S[i * 2], y: approx.data32S[i * 2 + 1] });
        }
        
        // הגדרת גבולות המסגרת האדומה (ROI)
        const frameXStart = src.cols * FRAME_PERCENT_X;
        const frameYStart = src.rows * FRAME_PERCENT_Y;
        const frameXEnd = src.cols * (1 - FRAME_PERCENT_X);
        const frameYEnd = src.rows * (1 - FRAME_PERCENT_Y);

        // בדיקה: האם כל 4 הפינות נמצאות בתוך גבולות המסגרת?
        let allInBounds = cornerPoints.every(p => 
            p.x > frameXStart && p.x < frameXEnd &&
            p.y > frameYStart && p.y < frameYEnd
        );

        isDocumentValid = allInBounds;
    }
    
    // שחרור זיכרון
    gray.delete(); blur.delete(); canny.delete(); contours.delete(); hierarchy.delete();
    if (maxContour) maxContour.delete();
    if (approx) approx.delete();

    return isDocumentValid;
}


// --- פונקציית העיבוד הסופי (Warp Perspective) - כמעט זהה לקוד הקודם ---
// [הכנס לכאן את כל הקוד של פונקציית processImage() הקודמת, וקרא לה processImageFinal]

function processImageFinal(src) {
    // ... כל הקוד שלב 3 עד 12 של processImage() מהתשובה הקודמת...
    // *הערה:* השתמש ב-src שקיבלת כארגומנט במקום cv.imread(canvasOutput)
    
    let dst = new cv.Mat();
    let gray = new cv.Mat();
    let blur = new cv.Mat();
    let canny = new cv.Mat();
    
    // 2. הכנה ועיבוד ראשוני (חזרה על מציאת המתאר, כדי לקבל את הפינות המדויקות)
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0); 
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0, 0); 
    cv.Canny(blur, canny, 75, 200, 3, false); 

    // 3. מציאת המתארים (Contours)
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();
    cv.findContours(canny, contours, hierarchy, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);

    let maxArea = 0;
    let maxContour = null;

    // 4. חיפוש המתאר הגדול ביותר
    for (let i = 0; i < contours.size(); ++i) {
        let contour = contours.get(i);
        let area = cv.contourArea(contour);
        
        if (area > 5000) { 
            if (area > maxArea) {
                maxArea = area;
                maxContour = contour;
            }
        }
        contour.delete(); 
    }

    if (!maxContour) {
        // אם לא נמצא, נציג את המקור
        cv.imshow('canvasOutput', src); 
        src.delete(); gray.delete(); blur.delete(); canny.delete(); contours.delete(); hierarchy.delete();
        return;
    }
    
// 5. קירוב (Approximation) המתאר ומציאת 4 הפינות (ב-processImageFinal)
    let approx = new cv.Mat();
    let perimeter = cv.arcLength(maxContour, true); 
    // שינוי: עדכון דיוק סופי ל-0.04 כדי להבטיח זיהוי 4 פינות גם בצילום הסופי
    cv.approxPolyDP(maxContour, approx, 0.04 * perimeter, true);

    if (approx.rows !== 4) {
        // נציג את המקור
        cv.imshow('canvasOutput', src); 
        approx.delete();
        src.delete(); gray.delete(); blur.delete(); canny.delete(); contours.delete(); hierarchy.delete();
        return;
    }

    // 6. מיון הפינות
    let cornerPoints = [];
    for (let i = 0; i < approx.rows; i++) {
        cornerPoints.push({ x: approx.data32S[i * 2], y: approx.data32S[i * 2 + 1] });
    }

    // פונקציית עזר למיון הפינות
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
    
    // 7. הגדרת מידות הפלט (יעד)
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
    
    // 8. יצירת מטריצת הטרנספורמציה (המפה)
    let M = cv.getPerspectiveTransform(srcPointsMat, destPointsMat);
    
    // 9. יישום הטרנספורמציה (Perspective Warp)
    let finalDst = new cv.Mat();
    let dsize = new cv.Size(maxWidth, maxHeight);
    
    cv.warpPerspective(src, finalDst, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

    // 10. שיפור איכות סופי (המרה לשחור-לבן קלאסי)
    let finalGray = new cv.Mat();
    cv.cvtColor(finalDst, finalGray, cv.COLOR_RGBA2GRAY, 0);
    // הוספת סף אדפטיבי לאיכות סריקה מעולה
    cv.adaptiveThreshold(finalGray, finalGray, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 11, 2);


    // 11. הצגת התוצאה הסופית בקנבס
    cv.imshow('canvasOutput', finalGray);
    
    // 12. שחרור זיכרון (חובה!)
    gray.delete(); blur.delete(); canny.delete(); 
    contours.delete(); hierarchy.delete(); approx.delete();
    srcPointsMat.delete(); destPointsMat.delete(); M.delete();
    finalDst.delete(); finalGray.delete();
    // לא משחררים את src כי הוא הגיע מהקריאה הראשית
    
    console.log("עיבוד תמונה הושלם. בוצע תיקון פרספקטיבה ושיפור איכות.");
}