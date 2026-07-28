export default async function handler(req, res) {
  try {

    console.log("APPS_SCRIPT_URL =", process.env.APPS_SCRIPT_URL);

    const response = await fetch(process.env.APPS_SCRIPT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(req.body)
    });

    const data = await response.json();

    return res.status(200).json(data);

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      error: err.message
    });

  }
}