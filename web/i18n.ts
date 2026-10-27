/** Interface text in the five languages FairShift ships with. Short words, read aloud where it helps. */
export type Lang = "en" | "hi" | "ta" | "te" | "kn";

export const LANG_LABEL: Record<Lang, string> = { en: "English", hi: "हिन्दी", ta: "தமிழ்", te: "తెలుగు", kn: "ಕನ್ನಡ" };
/** BCP-47 tags for speech recognition and speech synthesis. */
export const SPEECH: Record<Lang, string> = { en: "en-IN", hi: "hi-IN", ta: "ta-IN", te: "te-IN", kn: "kn-IN" };

const en = {
  hello: "Hello",
  shift: "My shift",
  pay: "My pay",
  safety: "Report danger",
  voice: "Speak up",
  skills: "My skills",
  checkIn: "Start work",
  checkOut: "End work",
  onShiftSince: "Working since",
  notOnShift: "Not at work",
  scanQr: "Scan site QR",
  useLocation: "Use my location",
  typeCode: "or type the code on the poster",
  hours14: "Last 14 days",
  regular: "Regular hours",
  overtime: "Overtime hours",
  tired: "Rest warning",
  takeHome: "Take-home pay",
  last30: "Last 30 days",
  thisWeek: "Last 7 days",
  explain: "Explain my pay",
  listen: "Listen",
  askPay: "Ask about my pay",
  whatDanger: "What is the danger? Speak or type.",
  speak: "Speak",
  stop: "Stop",
  send: "Send",
  anonymous: "Don't show my name",
  sent: "Sent. Thank you.",
  myReports: "My reports",
  open: "Open",
  acknowledged: "Seen by manager",
  fixed: "Fixed",
  feedbackTitle: "Tell us honestly. Your name is never saved.",
  manager: "Manager",
  conditions: "Work conditions",
  topicPay: "Pay",
  topicSafety: "Safety",
  passport: "Skill passport: your record of training and experience, yours to keep.",
  verified: "Verified",
  logout: "Log out",
  back: "Back",
};
type Dict = typeof en;

const hi: Dict = {
  hello: "नमस्ते", shift: "मेरी शिफ्ट", pay: "मेरी तनख्वाह", safety: "खतरा बताएं", voice: "अपनी बात कहें", skills: "मेरे हुनर",
  checkIn: "काम शुरू", checkOut: "काम खत्म", onShiftSince: "काम पर, शुरू", notOnShift: "काम पर नहीं", scanQr: "साइट QR स्कैन करें",
  useLocation: "मेरी लोकेशन से", typeCode: "या पोस्टर का कोड लिखें", hours14: "पिछले 14 दिन", regular: "सामान्य घंटे", overtime: "ओवरटाइम घंटे",
  tired: "आराम की चेतावनी", takeHome: "हाथ में तनख्वाह", last30: "पिछले 30 दिन", thisWeek: "पिछले 7 दिन", explain: "तनख्वाह समझाएं",
  listen: "सुनें", askPay: "तनख्वाह के बारे में पूछें", whatDanger: "खतरा क्या है? बोलें या लिखें।", speak: "बोलें", stop: "रुकें", send: "भेजें",
  anonymous: "मेरा नाम न दिखाएं", sent: "भेज दिया। धन्यवाद।", myReports: "मेरी शिकायतें", open: "खुली", acknowledged: "मैनेजर ने देखा",
  fixed: "ठीक हो गया", feedbackTitle: "सच बताइए। आपका नाम कभी सेव नहीं होता।", manager: "मैनेजर", conditions: "काम का माहौल",
  topicPay: "तनख्वाह", topicSafety: "सुरक्षा", passport: "हुनर पासपोर्ट: आपकी ट्रेनिंग और अनुभव का रिकॉर्ड, हमेशा आपका।",
  verified: "प्रमाणित", logout: "लॉग आउट", back: "वापस",
};
const ta: Dict = {
  hello: "வணக்கம்", shift: "என் ஷிப்ட்", pay: "என் சம்பளம்", safety: "ஆபத்தை சொல்லுங்கள்", voice: "உங்கள் கருத்து", skills: "என் திறமைகள்",
  checkIn: "வேலை தொடங்கு", checkOut: "வேலை முடி", onShiftSince: "வேலையில், தொடக்கம்", notOnShift: "வேலையில் இல்லை", scanQr: "தள QR ஸ்கேன்",
  useLocation: "என் இருப்பிடம்", typeCode: "அல்லது போஸ்டர் குறியீட்டை எழுதுங்கள்", hours14: "கடந்த 14 நாட்கள்", regular: "சாதாரண மணி",
  overtime: "கூடுதல் நேரம்", tired: "ஓய்வு எச்சரிக்கை", takeHome: "கையில் சம்பளம்", last30: "கடந்த 30 நாட்கள்", thisWeek: "கடந்த 7 நாட்கள்",
  explain: "சம்பளத்தை விளக்கு", listen: "கேளுங்கள்", askPay: "சம்பளம் பற்றி கேளுங்கள்", whatDanger: "என்ன ஆபத்து? பேசுங்கள் அல்லது எழுதுங்கள்.",
  speak: "பேசு", stop: "நிறுத்து", send: "அனுப்பு", anonymous: "என் பெயரை காட்ட வேண்டாம்", sent: "அனுப்பப்பட்டது. நன்றி.",
  myReports: "என் புகார்கள்", open: "திறந்தது", acknowledged: "மேலாளர் பார்த்தார்", fixed: "சரி செய்யப்பட்டது",
  feedbackTitle: "உண்மையை சொல்லுங்கள். உங்கள் பெயர் சேமிக்கப்படாது.", manager: "மேலாளர்", conditions: "வேலை சூழல்", topicPay: "சம்பளம்",
  topicSafety: "பாதுகாப்பு", passport: "திறன் பாஸ்போர்ட்: உங்கள் பயிற்சி, அனுபவ பதிவு, என்றும் உங்களுடையது.", verified: "சரிபார்க்கப்பட்டது",
  logout: "வெளியேறு", back: "பின்",
};
const te: Dict = {
  hello: "నమస్తే", shift: "నా షిఫ్ట్", pay: "నా జీతం", safety: "ప్రమాదం చెప్పండి", voice: "మీ మాట", skills: "నా నైపుణ్యాలు",
  checkIn: "పని మొదలు", checkOut: "పని ముగింపు", onShiftSince: "పనిలో, మొదలు", notOnShift: "పనిలో లేరు", scanQr: "సైట్ QR స్కాన్",
  useLocation: "నా లొకేషన్", typeCode: "లేదా పోస్టర్ కోడ్ రాయండి", hours14: "గత 14 రోజులు", regular: "సాధారణ గంటలు", overtime: "ఓవర్‌టైమ్ గంటలు",
  tired: "విశ్రాంతి హెచ్చరిక", takeHome: "చేతికి జీతం", last30: "గత 30 రోజులు", thisWeek: "గత 7 రోజులు", explain: "జీతం వివరించు",
  listen: "వినండి", askPay: "జీతం గురించి అడగండి", whatDanger: "ప్రమాదం ఏమిటి? మాట్లాడండి లేదా రాయండి.", speak: "మాట్లాడు", stop: "ఆపు",
  send: "పంపు", anonymous: "నా పేరు చూపవద్దు", sent: "పంపబడింది. ధన్యవాదాలు.", myReports: "నా ఫిర్యాదులు", open: "తెరిచి ఉంది",
  acknowledged: "మేనేజర్ చూశారు", fixed: "సరిచేశారు", feedbackTitle: "నిజం చెప్పండి. మీ పేరు ఎప్పుడూ సేవ్ కాదు.", manager: "మేనేజర్",
  conditions: "పని పరిస్థితులు", topicPay: "జీతం", topicSafety: "భద్రత", passport: "నైపుణ్య పాస్‌పోర్ట్: మీ శిక్షణ, అనుభవ రికార్డు, ఎప్పటికీ మీదే.",
  verified: "ధృవీకరించబడింది", logout: "లాగ్ అవుట్", back: "వెనుకకు",
};
const kn: Dict = {
  hello: "ನಮಸ್ಕಾರ", shift: "ನನ್ನ ಶಿಫ್ಟ್", pay: "ನನ್ನ ಸಂಬಳ", safety: "ಅಪಾಯ ತಿಳಿಸಿ", voice: "ನಿಮ್ಮ ಮಾತು", skills: "ನನ್ನ ಕೌಶಲ್ಯ",
  checkIn: "ಕೆಲಸ ಆರಂಭ", checkOut: "ಕೆಲಸ ಮುಗಿಸು", onShiftSince: "ಕೆಲಸದಲ್ಲಿ, ಆರಂಭ", notOnShift: "ಕೆಲಸದಲ್ಲಿಲ್ಲ", scanQr: "ಸೈಟ್ QR ಸ್ಕ್ಯಾನ್",
  useLocation: "ನನ್ನ ಸ್ಥಳ", typeCode: "ಅಥವಾ ಪೋಸ್ಟರ್ ಕೋಡ್ ಬರೆಯಿರಿ", hours14: "ಕಳೆದ 14 ದಿನ", regular: "ಸಾಮಾನ್ಯ ಗಂಟೆ", overtime: "ಹೆಚ್ಚುವರಿ ಗಂಟೆ",
  tired: "ವಿಶ್ರಾಂತಿ ಎಚ್ಚರಿಕೆ", takeHome: "ಕೈಗೆ ಸಂಬಳ", last30: "ಕಳೆದ 30 ದಿನ", thisWeek: "ಕಳೆದ 7 ದಿನ", explain: "ಸಂಬಳ ವಿವರಿಸಿ", listen: "ಕೇಳಿ",
  askPay: "ಸಂಬಳದ ಬಗ್ಗೆ ಕೇಳಿ", whatDanger: "ಅಪಾಯ ಏನು? ಮಾತನಾಡಿ ಅಥವಾ ಬರೆಯಿರಿ.", speak: "ಮಾತನಾಡಿ", stop: "ನಿಲ್ಲಿಸಿ", send: "ಕಳುಹಿಸಿ",
  anonymous: "ನನ್ನ ಹೆಸರು ತೋರಿಸಬೇಡಿ", sent: "ಕಳುಹಿಸಲಾಗಿದೆ. ಧನ್ಯವಾದ.", myReports: "ನನ್ನ ದೂರುಗಳು", open: "ತೆರೆದಿದೆ", acknowledged: "ಮ್ಯಾನೇಜರ್ ನೋಡಿದ್ದಾರೆ",
  fixed: "ಸರಿಪಡಿಸಲಾಗಿದೆ", feedbackTitle: "ನಿಜ ಹೇಳಿ. ನಿಮ್ಮ ಹೆಸರು ಎಂದಿಗೂ ಉಳಿಸುವುದಿಲ್ಲ.", manager: "ಮ್ಯಾನೇಜರ್", conditions: "ಕೆಲಸದ ಪರಿಸ್ಥಿತಿ",
  topicPay: "ಸಂಬಳ", topicSafety: "ಸುರಕ್ಷತೆ", passport: "ಕೌಶಲ್ಯ ಪಾಸ್‌ಪೋರ್ಟ್: ನಿಮ್ಮ ತರಬೇತಿ ಮತ್ತು ಅನುಭವದ ದಾಖಲೆ, ಯಾವಾಗಲೂ ನಿಮ್ಮದು.",
  verified: "ಪರಿಶೀಲಿಸಲಾಗಿದೆ", logout: "ಲಾಗ್ ಔಟ್", back: "ಹಿಂದೆ",
};

const DICTS: Record<Lang, Dict> = { en, hi, ta, te, kn };
export type Key = keyof Dict;
export const t = (lang: Lang, key: Key) => DICTS[lang][key];
