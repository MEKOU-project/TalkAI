# TalkAI

llamaを起動しておくこと
whisperを起動しておくこと
docker起動
llama起動
whisper起動
docker run -d -p 9000:8000 fedirz/faster-whisper-server:latest-cpu
qdrant起動
docker run -d -p 6333:6333 -p 6334:6334 --name mekou_qdrant qdrant/qdrant
docker run -d -p 6333:6333 -p 6334:6334 `
    --name mekou_qdrant `
    -v C:\qdrant_data:/qdrant/storage `
    qdrant/qdrant
ほんとならgpu版のほうが良いが、私の環境ではうまく動かなかったため、CPU版を使用しています。