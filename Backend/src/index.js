const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const pdf = require('pdf-parse');
const PDFParser = require('pdf2json');
const textract = require('textract');
require('dotenv').config();

const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const port = 4000;
const cors = require('cors');
app.use(cors());

// Middleware for parsing JSON
app.use(express.json());

// Configure multer to save files to the 'uploads/' directory
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');  // Save files to 'uploads/' directory
    },
    filename: (req, file, cb) => {
        // Extract the file extension from the original file name
        const ext = path.extname(file.originalname);
        const newFileName = `${Date.now()}${ext}`;  // Create a new name with timestamp
        cb(null, newFileName);  // Save the file with the new name
    },
});

const upload = multer({ storage: storage });
//const upload = multer({ dest: 'uploads/' });

// Google Generative AI Setup
const apiKey = "AIzaSyB8BtyLvkJK6fBtMvwJOfeKhiLNbnpjj4U";
const genAI = new GoogleGenerativeAI(apiKey);

const model = genAI.getGenerativeModel({
    model: "gemini-pro",
});

const generationConfig = {
    temperature: 1,
    topP: 0.95,
    topK: 40,
    maxOutputTokens: 8192,
    responseMimeType: "text/plain",
};

// Enhanced file reading function
async function readFileContent(filePath) {
    const fileExtension = path.extname(filePath).toLowerCase();

    try {
        // Check if the file exists before processing
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }

        switch (fileExtension) {
            case '.txt':
                return fs.readFileSync(filePath, 'utf8');

            case '.docx':
                const docxResult = await mammoth.extractRawText({ path: filePath });
                return docxResult.value;

            case '.pdf':
                const dataBuffer = fs.readFileSync(filePath);
                const pdfResult = await pdf(dataBuffer);
                return pdfResult.text;

            default:
                return await new Promise((resolve, reject) => {
                    textract.fromPath(filePath, (error, text) => {
                        if (error) reject(error);
                        else resolve(text);
                    });
                });
        }
    } catch (error) {
        console.error(`Error reading file ${filePath}:`, error);
        throw error;
    }
}

// Question Generation Pipeline using Google Generative AI
async function generateQuestionsFromText(inputText) {
    try {
        const chatSession = model.startChat({
            generationConfig,
            history: [],
        });

        // Prompt for generating questions
        const prompt = `Generate random 100 multiple-choice questions from the following content:\n\n${inputText}\n\n \
        This should proceed from basic to intermediate and then advance at appropriate proportion \
        to make the reader better understand the context.Format the output as a JSON array where each question has an id (starting from 1), text, \
        options (an array of 4 choices), and correctAnswer.`;

        const result = await chatSession.sendMessage(prompt);
        const responseText = result.response.text();

        // Additional parsing to handle potential AI response variations
        const jsonMatch = responseText.match(/\[.*\]/s);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }

        // Fallback parsing
        try {
            return JSON.parse(responseText);
        } catch (parseError) {
            console.error('Failed to parse AI response:', responseText);
            throw new Error('Invalid response format from AI');
        }
    } catch (error) {
        console.error('Error during question generation:', error);
        throw new Error('Failed to generate questions from Google Generative AI.');
    }
}

// Route for file upload and question generation
app.post('/generate-questions', upload.single('file'), async (req, res) => {
    try {
        // Step 1: Validate uploaded file
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded.' });
        }

        const filePath = req.file.path;
        console.log(`The uploaded filepath: ${filePath}`);

        // Step 2: Read and process the uploaded file
        const fileContent = await readFileContent(filePath);

        // Truncate content if it's too long
        // const truncatedContent = fileContent.length > 5000 
        //     ? fileContent.substring(0, 5000) 
        //     : fileContent;

        // Truncate to 5000 words
        const truncatedContent = fileContent.split(/\s+/).slice(0, 5000).join(' ');

        // Step 3: Generate questions using Google Generative AI
        const questionsWithOptions = await generateQuestionsFromText(truncatedContent);

        // Step 4: Clean up the uploaded file
        fs.unlinkSync(filePath);

        // Step 5: Respond with the generated questions
        res.status(200).json({ questions: questionsWithOptions });
    } catch (error) {
        console.error('Error generating questions:', error);

        // Clean up file in case of error
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        // Handle errors and provide detailed feedback
        res.status(500).json({ 
            error: 'Failed to generate questions.', 
            details: error.message 
        });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});

module.exports = { app, readFileContent, generateQuestionsFromText };