import { google } from 'googleapis';

export default async function handler(req, res) {
    try {
        // 步驟一：認證 Google API (和 verify.js 一樣)
        // 如果這一步失敗，代表 GOOGLE_CREDENTIALS 有問題
        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'], // 使用唯讀權限，更安全
        });

        const sheets = google.sheets({ version: 'v4', auth });
        
        // 步驟二：讀取您的 Google Sheet
        // 如果這一步失敗，代表 SHEET_ID 或權限有問題
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SHEET_ID,
            range: '匯款紀錄!A1:I10', // 只讀取前10行，A到I欄
        });

        const rows = response.data.values;

        // 步驟三：直接將讀取到的原始資料回傳給瀏覽器
        // 如果前面都成功，您會在瀏覽器上看到這些資料
        res.status(200).json({
            message: "✅ 成功從 Google Sheet 讀取資料！",
            data: rows
        });

    } catch (error) {
        // 如果中間任何一步出錯，就在 Vercel 日誌中印出詳細錯誤
        console.error('偵錯 API 發生錯誤:', error);
        // 並回傳一個錯誤訊息給瀏覽器
        res.status(500).json({
            message: "❌ 讀取 Google Sheet 時發生錯誤。",
            error: error.message,
        });
    }
}