import axios from "axios";

const GEMINI_UPLOAD_URL =
  "https://generativelanguage.googleapis.com/upload/v1beta/files";
const GEMINI_GENERATE_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");
  return key;
}

export async function uploadVideo(
  videoBuffer: Buffer,
  mimeType: string,
): Promise<{ uri: string; mimeType: string }> {
  const key = getApiKey();

  const response = await axios.post(
    `${GEMINI_UPLOAD_URL}?key=${key}`,
    videoBuffer,
    {
      headers: {
        "X-Goog-Upload-Command": "start, upload, finalize",
        "X-Goog-Upload-Header-Content-Length": String(videoBuffer.length),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "Content-Type": mimeType,
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 300000,
    },
  );

  const fileName = response.data.file.name;
  const fileUri = response.data.file.uri;
  const fileMimeType = response.data.file.mimeType;

  await waitForFileActive(fileName);

  return { uri: fileUri, mimeType: fileMimeType };
}

async function waitForFileActive(
  fileName: string,
  maxWaitMs = 120000,
): Promise<void> {
  const key = getApiKey();
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const response = await axios.get(
      `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${key}`,
    );
    const state = response.data.state;
    if (state === "ACTIVE") return;
    if (state === "FAILED")
      throw new Error(`Gemini file processing failed for ${fileName}`);
    await new Promise((r) => setTimeout(r, 3000));
  }

  throw new Error(
    `Gemini file ${fileName} did not become ACTIVE within ${maxWaitMs / 1000}s`,
  );
}

export async function analyzeVideo(
  fileUri: string,
  mimeType: string,
  analysisPrompt: string,
  maxRetries = 3,
): Promise<string> {
  const key = getApiKey();

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await axios.post(
        `${GEMINI_GENERATE_URL}?key=${key}`,
        {
          contents: [
            {
              role: "user",
              parts: [
                { fileData: { fileUri, mimeType } },
                { text: analysisPrompt },
              ],
            },
          ],
        },
        { timeout: 60000 },
      );

      const text =
        response.data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const hashIndex = text.indexOf("#");
      return hashIndex >= 0 ? text.substring(hashIndex) : text;
    } catch (error) {
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      throw error;
    }
  }

  throw new Error("Gemini analysis failed after retries");
}
