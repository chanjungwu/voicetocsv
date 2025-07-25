import { google } from 'googleapis';
import { v4 as uuidv4 } from 'uuid';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: '僅允許 POST 請求' });
    }

    try {
        // ... (前面的認證代碼都一樣，不需要動)
        const { amount, date, time, account, email } = req.body;

        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = process.env.SHEET_ID;
        const range = '工作表1!A:D';
        const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
        const rows = response.data.values;
        
        if (!rows || rows.length === 0) {
            return res.status(500).json({ error: '無法讀取付款紀錄表' });
        }

        let matchRowIndex = -1;
        
        // 建立使用者輸入的 Date 物件 (台灣時間)
        const userInputDate = new Date(`${date}T${time}:00+08:00`);
        userInputDate.setSeconds(0, 0); // 【關鍵修正】將秒數歸零

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const [sheetTime, sheetAccount, sheetAmount, sheetStatus] = row;
            
            if (!sheetTime || !sheetAmount) continue;
            
            // 建立 Google Sheet 中的 Date 物件 (台灣時間)
            const sheetDateString = `${sheetTime.replace(/\//g, '-')}:00+08:00`.replace(' ', 'T');
            const sheetDate = new Date(sheetDateString);
            sheetDate.setSeconds(0, 0); // 【關鍵修正】將秒數歸零

            const timeDifference = Math.abs(userInputDate - sheetDate) / (1000 * 60);
            const isAmountMatch = parseInt(sheetAmount.trim(), 10) === parseInt(amount, 10);
            const isTimeMatch = timeDifference < 1; // 時間差小於1分鐘即可
            const isStatusAvailable = !sheetStatus || sheetStatus.trim() === '尚未使用';

            if (isAmountMatch && isTimeMatch && isStatusAvailable) {
                matchRowIndex = i;
                break;
            }
        }

        if (matchRowIndex === -1) {
            return res.status(404).json({ error: '找不到匹配的付款紀錄。請確認金額和時間是否正確，或該筆紀錄已被使用。' });
        }

        // ... (後面的更新表格和回傳代碼部分都一樣，不需要動)
        const activationCode = `VOICE-CSV-${uuidv4().split('-')[0].toUpperCase()}`;
        const updateRange = `工作表1!D${matchRowIndex + 1}`;
        const updateValues = [[`已啟用 - ${activationCode} | Email: ${email} | 帳號: ${account}`]];
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: updateRange,
            valueInputOption: 'USER_ENTERED',
            resource: { values: updateValues },
        });
        return res.status(200).json({ activationCode });

    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ error: '伺服器內部錯誤，請聯繫管理員。' });
    }
}