import dotenv from "dotenv";
dotenv.config();

async function listModels() {
  console.log("Attempting to load GOOGLE_API_KEY...");
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error("Error: GOOGLE_API_KEY is not defined. Please check your .env file.");
    return;
  }
  console.log("GOOGLE_API_KEY loaded (first 5 chars):", apiKey.substring(0, 5) + "..."); // Don't log the full key!

  try {
    const url = "https://generativelanguage.googleapis.com/v1beta/models?key=" + apiKey;
    console.log("Fetching from URL:", url);

    const response = await fetch(url);

    if (!response.ok) {
      // If the response is not OK (e.g., 401, 403, 500)
      const errorData = await response.json();
      console.error(`HTTP Error: ${response.status} ${response.statusText}`, errorData);
      return;
    }

    const data = await response.json();
    console.log("Full API response data:", data); // Log the full response for more clues

    if (data.models && data.models.length > 0) {
      console.log("Available models:");
      data.models.forEach((m) => console.log(m.name));
    } else {
      console.log("No models found or 'models' array is empty in the response.");
    }
  } catch (error) {
    console.error("Error listing models:", error);
  }
}

listModels();
