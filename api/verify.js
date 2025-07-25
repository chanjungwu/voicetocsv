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
        const userInputDate = new Date(`${date}T${time}:00+08:00`);
        userInputDate.setSeconds(0, 0);

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length === 0) continue;

            const sheetTimeStr = row[0];
            const sheetAmount = row[1];
            const sheetStatus = row[6];

            if (!sheetTimeStr || !sheetAmount) continue;

            const sheetDate = new Date(`${sheetTimeStr.replace(/\//g, '-')}:00+08:00`.replace(' ', 'T'));
            sheetDate.setSeconds(0, 0);

            const timeDifference = Math.abs(userInputDate - sheetDate) / (1000 * 60);

            const isAmountMatch = parseInt(sheetAmount.trim(), 10) === parseInt(amount, 10);
            const isTimeMatch = timeDifference < 1;
            const isStatusAvailable = !sheetStatus || sheetStatus.trim() === '';

            // 【最終修正】只比對金額、時間、啟用狀態
            if (isAmountMatch && isTimeMatch && isStatusAvailable) {
                matchRowIndex = i;
                break;
            }
        }

        if (matchRowIndex === -1) {
            return res.status(404).json({ error: '找不到匹配的付款紀錄。請確認金額和時間是否正確，或該筆紀錄已被使用。' });
        }

        const activationCode = `VOICE-CSV-${uuidv4().split('-')[0].toUpperCase()}`;
        
        // 將啟用碼寫入 G 欄
        const updateRange = `工作表1!G${matchRowIndex + 1}`;
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: updateRange,
            valueInputOption: 'USER_ENTERED',
            resource: { values: [[activationCode]] },
        });

        // 將客戶填寫的 Email 更新到 F 欄
        const emailUpdateRange = `工作表1!F${matchRowIndex + 1}`;
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: emailUpdateRange,
            valueInputOption: 'USER_ENTERED',
            resource: { values: [[email]] },
        });
        
        // 將客戶填寫的帳號後五碼更新到 D 欄 (作為人工備核)
        const accountUpdateRange = `工作表1!D${matchRowIndex + 1}`;
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: accountUpdateRange,
            valueInputOption: 'USER_ENTERED',
            resource: { values: [[account]] },
        });

        return res.status(200).json({ activationCode });

    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ error: '伺服器內部錯誤，請聯繫管理員。' });
    }
}