import { google } from 'googleapis';
import { v4 as uuidv4 } from 'uuid';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: '僅允許 POST 請求' });
    }

    try {
        const { amount, date, time, account, email } = req.body;

        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = process.env.SHEET_ID;
        const range = '工作表1!A:I';

        const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            return res.status(500).json({ error: '無法讀取付款紀錄表' });
        }

        let matchRowIndex = -1;

        // 【最終修正】組合出使用者輸入的目標時間字串 (格式 YYYY/MM/DD HH:mm)
        const userDateStr = date.replace(/-/g, '/'); // 將 YYYY-MM-DD 換成 YYYY/MM/DD
        const targetTimeStr = `${userDateStr} ${time}`;

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length === 0) continue;

            const sheetTimeStr = row[0];   // 欄位 A: 匯款時間 (例如 "2025/07/25 11:59:09")
            const sheetAmount = row[1];  // 欄位 B: 匯款金額
            const sheetStatus = row[6];    // 欄位 G: 授權碼

            if (!sheetTimeStr || !sheetAmount) continue;

            // 【最終修正】直接比對字串，忽略秒數
            // sheetTimeStr.startsWith(targetTimeStr) 會檢查 "2025/07/25 11:59:09" 是否以 "2025/07/25 11:59" 開頭
            const isTimeMatch = sheetTimeStr.startsWith(targetTimeStr);
            const isAmountMatch = parseInt(sheetAmount.trim(), 10) === parseInt(amount, 10);
            const isStatusAvailable = !sheetStatus || sheetStatus.trim() === '';

            if (isAmountMatch && isTimeMatch && isStatusAvailable) {
                matchRowIndex = i;
                break;
            }
        }

        if (matchRowIndex === -1) {
            return res.status(404).json({ error: '找不到匹配的付款紀錄。請確認金額和時間是否正確，或該筆紀錄已被使用。' });
        }

        // --- 後續更新表格的程式碼完全一樣，不需要修改 ---
        const activationCode = `VOICE-CSV-${uuidv4().split('-')[0].toUpperCase()}`;
        const updateRange = `工作表1!G${matchRowIndex + 1}`;
        await sheets.spreadsheets.values.update({ spreadsheetId, range: updateRange, valueInputOption: 'USER_ENTERED', resource: { values: [[activationCode]] } });
        const emailUpdateRange = `工作表1!F${matchRowIndex + 1}`;
        await sheets.spreadsheets.values.update({ spreadsheetId, range: emailUpdateRange, valueInputOption: 'USER_ENTERED', resource: { values: [[email]] } });
        const accountUpdateRange = `工作表1!D${matchRowIndex + 1}`;
        await sheets.spreadsheets.values.update({ spreadsheetId, range: accountUpdateRange, valueInputOption: 'USER_ENTERED', resource: { values: [[account]] } });
        return res.status(200).json({ activationCode });

    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ error: '伺服器內部錯誤，請聯繫管理員。' });
    }
}