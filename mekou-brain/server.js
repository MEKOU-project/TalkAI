import express from 'express';
import cors from 'cors';
import axios from 'axios';
import multer from 'multer';
import FormData from 'form-data';

const app = express();
const upload = multer();

app.use(cors());
app.use(express.json());

import { QdrantClient } from '@qdrant/js-client-rest';
const qdrant = new QdrantClient({ url: 'http://localhost:6333' });

// --- 補助関数：テキストをベクトル化する ---
async function getEmbedding(text) {
    try {
        // ここで URL とモデル名を確認
        const res = await axios.post('http://localhost:11434/api/embeddings', {
            model: "mxbai-embed-large",
            prompt: text
        });
        return res.data.embedding;
    } catch (e) {
        console.error("--- Ollama Embedding Error ---");
        console.error("URL:", e.config?.url);
        console.error("Status:", e.response?.status); // ここが 404 なら URL 間違い
        console.error("Data:", e.response?.data);     // モデルがない等のメッセージ
        throw e;
    }
}

// --- 記憶の全件登録（バックグラウンドで実行可） ---
async function saveToQdrant(text) {
    const vector = await getEmbedding(text);
    await qdrant.upsert("mekou_exp", {
        wait: false,
        points: [{
            id: Date.now(), // 簡易的なID生成
            vector: vector,
            payload: { text: text, timestamp: new Date().toISOString(), type: "raw_speech" }
        }]
    });
}

// --- コンテキスト検索 ---
async function searchQdrant(text, collection) {
    const vector = await getEmbedding(text);
    const results = await qdrant.search(collection, {
        vector: vector,
        limit: 3
    });
    return results.map(r => r.payload.text).join("\n");
}

app.post('/api/voice-chat', upload.single('file'), async (req, res) => {
    try {
        let finalUserText = "";

        // 1. 入力ソースの切り分け
        if (req.file) {
            // --- 音声入力の場合：Whisperで文字起こし ---
            const form = new FormData();
            form.append('file', req.file.buffer, { 
                filename: 'voice.wav', 
                contentType: 'audio/wav' 
            });

            const sttResponse = await axios.post('http://localhost:9000/v1/audio/transcriptions', form, {
                headers: form.getHeaders(),
                params: { 
                    model: "base",
                    language: "ja",
                    initial_prompt: "MEKOU, 助向, タスク, システム" 
                }
            });
            finalUserText = sttResponse.data.text;
        } else if (req.body.text) {
            // --- テキスト入力の場合：そのまま使用 ---
            finalUserText = req.body.text;
        } else {
            return res.status(400).json({ error: "No input provided" });
        }

        console.log(`>>> Processed Input: ${finalUserText}`);

        // 2. 記憶の保存と検索
        await saveToQdrant(finalUserText);
        const relevantContext = await searchQdrant(finalUserText, "mekou_exp");
        console.log("Context Retrieved:", relevantContext);

        // --- ヘッダー送信（ストリーミング開始） ---
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        // クライアント側で認識結果を表示するために一度送る
        res.write(JSON.stringify({ message: { content: "" }, user_input: finalUserText }) + '\n');

        // 3. Ollamaへのリクエスト
        const ollamaRes = await axios.post('http://localhost:11434/api/chat', {
            model: "llama3.1",
            messages: [
                { role: "system", content: `あなたはMEKOUの制御AI(MIKO)です。短く、端的に結論を述べて。無駄な同調は不要。\n背景知識:\n${relevantContext}` },
                { role: "user", content: finalUserText }
            ],
            stream: true 
        }, { responseType: 'stream' });

        ollamaRes.data.on('data', (chunk) => res.write(chunk));
        ollamaRes.data.on('end', () => res.end());

    } catch (error) {
        console.error("Nerve System Error:", error.message);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        } else {
            res.end();
        }
    }
});

app.listen(3000, () => console.log("MEKOU Nerve System [Streaming Mode] :3000"));