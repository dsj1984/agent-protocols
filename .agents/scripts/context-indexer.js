import fs from 'fs';
import path from 'path';

// Implements a lightweight, zero-dependency TF-IDF indexer for Local RAG
const tempDir = path.join(process.cwd(), 'temp');
const INDEX_PATH = path.join(process.cwd(), 'temp', 'context-index.json');
const DOCS_DIR = path.join(process.cwd(), 'docs');

function tokenize(text) {
    return text.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(w => w.length > 2);
}

function chunkText(text, filePath) {
    // Split by Markdown headings or double newlines to isolate semantic blocks
    const rawChunks = text.split(/\n(?:#+) |\n\n/);
    const chunks = [];
    for (let i = 0; i < rawChunks.length; i++) {
        let content = rawChunks[i].trim();
        if (content.length > 50) { // Keep meaningful chunks
            chunks.push({ id: `${filePath}#chunk${i}`, filePath, content });
        }
    }
    return chunks;
}

function walkDir(dir) {
    let results = [];
    if (!fs.existsSync(dir)) return results;
    
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        if (file === 'node_modules' || file === 'temp' || file === '.git' || file === '.agents') return;
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat && stat.isDirectory()) {
            results = results.concat(walkDir(fullPath));
        } else if (file.endsWith('.md')) {
            results.push(fullPath);
        }
    });
    return results;
}

function buildIndex() {
    console.log(`Analyzing document hierarchy in ${DOCS_DIR}...`);
    if (!fs.existsSync(DOCS_DIR)) {
        console.error("Docs directory not found. Please run this script from the workspace root.");
        return;
    }
    
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    // Include docs/ but also the project root's specific architecture files if they are there
    let files = walkDir(DOCS_DIR);
    
    // Explicitly add root md files like README.md if present
    ['README.md', 'CHANGELOG.md'].forEach(rootFile => {
        const rootPath = path.join(process.cwd(), rootFile);
        if (fs.existsSync(rootPath)) files.push(rootPath);
    });

    let allChunks = [];
    files.forEach(file => {
        try {
            const text = fs.readFileSync(file, 'utf-8');
            const relPath = path.relative(process.cwd(), file);
            allChunks = allChunks.concat(chunkText(text, relPath));
        } catch (e) {
            console.warn(`Could not read ${file}: ${e.message}`);
        }
    });

    const df = {};
    const docs = [];

    // Phase 1: Term Frequencies & Doc Frequencies
    allChunks.forEach(chunk => {
        const tokens = tokenize(chunk.content);
        const tf = {};
        let totalTerms = 0;
        tokens.forEach(t => {
            tf[t] = (tf[t] || 0) + 1;
            totalTerms++;
        });
        
        for (let t in tf) tf[t] = tf[t] / totalTerms;

        const uniqueTokens = new Set(tokens);
        uniqueTokens.forEach(t => { df[t] = (df[t] || 0) + 1; });

        docs.push({
            id: chunk.id,
            filePath: chunk.filePath,
            content: chunk.content,
            tf
        });
    });

    // Phase 2: Inverse Document Frequency
    const numDocs = docs.length;
    const idf = {};
    for (let t in df) {
        idf[t] = Math.log(numDocs / (df[t] + 1)) + 1;
    }

    const index = { docs, idf, df, numDocs };
    fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
    console.log(`\n✅ Local RAG Index Built Successfully!`);
    console.log(`Indexed ${numDocs} semantic chunks across ${files.length} files.`);
    console.log(`Index saved to ${INDEX_PATH}`);
}

function searchIndex(query, topK = 5) {
    if (!fs.existsSync(INDEX_PATH)) {
        console.error("❌ No context index found. Please run `node .agents/scripts/context-indexer.js index` first.");
        return;
    }
    
    const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));
    const queryTokens = tokenize(query);
    
    const queryTf = {};
    queryTokens.forEach(t => queryTf[t] = (queryTf[t] || 0) + 1);

    const scores = [];

    index.docs.forEach(doc => {
        let score = 0;
        queryTokens.forEach(t => {
            if (doc.tf[t] && index.idf[t]) {
                // Cosine similarity approximation
                score += (doc.tf[t] * index.idf[t]) * (queryTf[t] * index.idf[t]);
            }
        });
        if (score > 0) scores.push({ doc, score });
    });

    scores.sort((a, b) => b.score - a.score);
    const results = scores.slice(0, topK);

    if (results.length === 0) {
        console.log(`No semantic matches found for: "${query}"`);
        return;
    }

    console.log(`\n🔍 Context Search Results for: "${query}"`);
    console.log(`====================================================`);
    results.forEach((r, i) => {
        console.log(`\n[Result ${i + 1}] Source: \`${r.doc.filePath}\` (Match Score: ${(r.score * 100).toFixed(1)})`);
        console.log("----------------------------------------------------");
        console.log(r.doc.content.trim());
        console.log("----------------------------------------------------");
    });
}

const command = process.argv[2];
const args = process.argv.slice(3);

if (command === 'index') {
    buildIndex();
} else if (command === 'search') {
    if (args.length === 0) {
        console.error("Please provide a search query. Example: node context-indexer.js search \"user authentication flow\"");
        process.exit(1);
    }
    searchIndex(args.join(' '));
} else {
    console.log("Context Indexer (Local RAG)");
    console.log("Usage:");
    console.log("  node .agents/scripts/context-indexer.js index                (Rebuilds the documentation index)");
    console.log("  node .agents/scripts/context-indexer.js search \"<query>\"   (Semantically search the repository context)");
}
