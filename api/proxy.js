export const config = {
  api: {
    bodyParser: {
      sizeLimit: "4mb"
    }
  }
};

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
      console.error("Apps Script did not return valid JSON:", rawText.slice(0, 500));
      return res.status(502).json({
        error: "Apps Script returned a non-JSON response (often means the web app URL is wrong, redirected to a login page, or the script threw an uncaught error)."
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