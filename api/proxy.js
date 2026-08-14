export const config = {
  api: {
    bodyParser: {
      sizeLimit: "4mb"
    }
  }
};

// Vercel Hobby plan ka default function timeout (~10s) tha, jo Apps Script
// ke 5-15s wale notification calls ko beech mein cut kar raha tha.
// Hobby plan ki max allowed limit (60s) tak badha rahe hain.
export const maxDuration = 60;
export default async function handler(req, res) {
  try {

    if (!process.env.APPS_SCRIPT_URL) {
      console.error("APPS_SCRIPT_URL env var is not set on this deployment");
      return res.status(500).json({
        error: "Server misconfigured: APPS_SCRIPT_URL is missing. Set it in Vercel → Project → Settings → Environment Variables."
      });
    }

    const body = JSON.stringify(req.body);
    console.log("action:", req.body && req.body.action, "| payload size(bytes):", body.length);

    const response = await fetch(process.env.APPS_SCRIPT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body
    });

    const rawText = await response.text();

    if (!response.ok) {
      console.error("Apps Script responded with", response.status, rawText.slice(0, 500));
      return res.status(502).json({
        error: `Apps Script returned ${response.status}. Check the deployment is set to "Execute as: Me" / "Who has access: Anyone", and that the deployment URL is current.`
      });
    }

    let data;
    try {
      data = JSON.parse(rawText);
    } catch (parseErr) {
  const action = req.body?.action || "unknown";
  const preview = rawText.slice(0, 500).replace(/\s+/g, " ");

  console.error(
    `[${action}] Apps Script did not return valid JSON:`,
    preview
  );

  return res.status(502).json({
    error: `[${action}] Apps Script returned a non-JSON response.`,
    ...(process.env.NODE_ENV !== "production"
      ? { upstreamPreview: preview }
      : {})
  });
}

    return res.status(200).json(data);

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      error: err.message
    });

  }
}