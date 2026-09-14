import os
import uuid
from datetime import datetime
from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

DOCUMENTS = [
    {"id": 1, "title": "The Design of Everyday Things", "author": "Don Norman", "type": "BOOK", "progress": 68},
    {"id": 2, "title": "Deep Work", "author": "Cal Newport", "type": "BOOK", "progress": 42},
]

@app.get('/api/health')
def health():
    return jsonify({"status": "ok", "service": "readvibe-api", "timestamp": datetime.utcnow().isoformat()})

@app.get('/api/documents')
def get_documents():
    return jsonify(DOCUMENTS)

@app.post('/api/documents')
def upload_document():
    file = request.files.get('file')
    if not file:
        return jsonify({"error": "A document file is required."}), 400
    item = {"id": str(uuid.uuid4()), "title": file.filename.rsplit('.', 1)[0], "author": "Uploaded document", "type": file.filename.rsplit('.', 1)[-1].upper(), "progress": 0}
    return jsonify({"message": "Document accepted for processing", "document": item, "job_id": str(uuid.uuid4())}), 202

@app.post('/api/ai/summarize')
def summarize():
    data = request.get_json(silent=True) or {}
    depth = data.get('depth', 'standard')
    return jsonify({"depth": depth, "summary": {"main_idea": "Good design makes the right action obvious and understandable.", "key_points": ["People build mental models from visual clues.", "Affordances communicate possible actions.", "Design should make room for mistakes."], "takeaways": "Make the next action clear, preserve context, and respect the reader's attention."}, "source": data.get('document_id')})

@app.post('/api/ai/chat')
def chat():
    data = request.get_json(silent=True) or {}
    question = data.get('question', '')
    return jsonify({"answer": f"Based on the document context, the key idea related to '{question}' is that clarity reduces the effort required to act. This is a grounded demo response; connect your model provider here for production inference.", "citations": [{"page": 184, "label": "Chapter 4 · The Design Challenge"}]})

@app.post('/api/audio/jobs')
def audio_job():
    data = request.get_json(silent=True) or {}
    return jsonify({"job_id": str(uuid.uuid4()), "status": "queued", "tone": data.get('tone', 'regular'), "progress": 0}), 202

@app.post('/api/research/discover')
def research_discover():
    data = request.get_json(silent=True) or {}
    topic = data.get('topic', 'your topic')
    return jsonify({"topic": topic, "sources": [{"title": "Understanding reading environments and cognitive load", "authors": ["ReadVibe Research Group"], "year": 2024, "relevance": 0.94, "provider": "Semantic Scholar"}, {"title": "Ambient sound, focus, and comprehension", "authors": ["A. Researcher", "B. Scholar"], "year": 2023, "relevance": 0.88, "provider": "Crossref"}]})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.getenv('PORT', 5000)), debug=True)
