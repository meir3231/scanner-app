// --- הגדרת משתנים גלובליים ---
const video = document.getElementById('videoElement');
const canvasOutput = document.getElementById('canvasOutput');
const scanButton = document.getElementById('scanButton');
// הוספת הארגומנט willReadFrequently לשיפור הביצועים
const context = canvasOutput.getContext('2d', { willReadFrequently: true });
const videoContainer = document.querySelector('.video-container');

let streaming = false;
// נגדיר תמיד שנמצא מסמך כדי לאפשר צילום חופשי
let isDocumentFound = true; 
let currentSrc = null; 

// --- הגדרות המסגרת (ROI) ודיוק הזיהוי (משמשות רק בעיבוד הסופי) ---
// אנו משתמשים בערכים שנקבעו ב-CSS למסגרת האנכית (left: 25%)
const FRAME_START_X_PCT = 0.25; 
const FRAME_START_Y_PCT = 0.05; 
// סף שטח מינימלי למסמך (עודכן ל-4000)
const MIN_DOCUMENT_AREA = 4000; 
// דיוק קירוב (עודכן ל-0.05 - סלחני מאוד)
const APPROX_PRECISION = 0.05; 

// --- פונקציה המופעלת כאשר OpenCV.js נטען ---
function onOpenCvReady() {
    console.log("OpenCV.js נטען בהצלחה.");
    
    // *** שחרור הכפתור באופן מיידי לצילום חופשי ***
    scanButton.disabled = false; 
    scanButton.textContent = "✅ צלם וסרוק חופשי!";

    // פונקציית עזר להפעלת המצלמה עם FacingMode
    function startCamera(facingMode) {
        const constraints = { 
            video: { 
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
                        // הפעלת לולאת ה-Tick לעיבוד בזמן אמת (לא משפיע על הכפתור)
                        requestAnimationFrame(processVideoTick); 
                    }
                }, false);
            })
            .catch(function (err) {
                console.error("שגיאת מצלמה עם facingMode: " + facingMode, err);
                
                if (facingMode === 'environment') {
                    console.log("נסיון מעבר למצלמה קדמית/ברירת מחדל...");
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
    
    // הגדרת כפתור הצילום - מופעל תמיד
    scanButton.onclick = function() {
        if (!isDocumentFound) return; // לא אמור לקרות כעת

        // עוצרים את לולאת הווידאו ומבצעים עיבוד
        streaming = false;
        videoContainer.style.display = 'none';
        canvasOutput.style.display = 'block';
        scanButton.textContent = "עיבוד הסריקה הושלם";
        
        processImageFinal(currentSrc);
    };
}


// --- לולאת עיבוד וידאו בזמן אמת (רק לקריאת הפריים, ללא בדיקת גבולות) ---
function processVideoTick() {
    if (!streaming) return;

    try {
        context.drawImage(video, 0, 0, canvasOutput.width, canvasOutput.height);
        
        // קורא את התמונה מהקנבס ושומר אותה ל-currentSrc
        if (currentSrc) currentSrc.delete();
        currentSrc = cv.imread(canvasOutput);
        
        // *** נמחק: לא מבצעים כאן את checkDocumentBounds ***
        
    } catch (e) {
        // ...
    }
    
    requestAnimationFrame(processVideoTick); 
}


// --- פונקציית לוגיקה שהוצאה משימוש (נשארת ריקה כרגע) ---
// אנחנו לא צריכים את זה כשהצילום חופשי
function checkDocumentBounds(src) {
    return true; 
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
        // אם לא נמצא מתאר, נציג את המקור
        cv.imshow('canvasOutput', src); 
        src.delete(); gray.delete(); blur.delete(); canny.delete(); contours.delete(); hierarchy.delete();
        return;
    }
    
    // 3. קירוב ומציאת 4 הפינות
    let approx = new cv.Mat();
    let perimeter = cv.arcLength(maxContour, true); 
    cv.approxPolyDP(maxContour, approx, APPROX_PRECISION * perimeter, true); 

    if (approx.rows !== 4) {
        // אם לא נמצאו 4 פינות מדויקות, נציג את המקור
        cv.imshow('canvasOutput', src); 
        approx.delete();
        src.delete(); gray.delete(); blur.delete(); canny.delete(); contours.delete(); hierarchy.delete();
        return;
    }

    // 4. מיון הפינות
    let cornerPoints = [];
    for (let i = 0; i < approx.rows; i++) {
        cornerPoints.push({ x: approx.data32S[i * 2], y: approx.data32S[i * 2
