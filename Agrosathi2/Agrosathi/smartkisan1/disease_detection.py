# =========================================================
# AGROSATHI AI - PLANT DISEASE DETECTION
# =========================================================

import os
import json
import base64

from groq import Groq
from dotenv import load_dotenv

load_dotenv()

MODEL = "qwen/qwen3.8-27b"
MAX_IMAGE_SIZE = 20 * 1024 * 1024

ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}


# =========================================================
# IMAGE HELPERS
# =========================================================

def is_allowed_image(filename):
    if not filename or "." not in filename:
        return False

    ext = filename.rsplit(".", 1)[1].lower()
    return ext in ALLOWED_EXTENSIONS


def image_to_data_url(image_file):
    filename = image_file.filename or ""

    if not is_allowed_image(filename):
        raise ValueError(
            "Please upload a JPG, JPEG, PNG or WEBP image."
        )

    ext = filename.rsplit(".", 1)[1].lower()

    mime = {
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "png": "image/png",
        "webp": "image/webp"
    }[ext]

    data = image_file.read()

    if not data:
        raise ValueError("The uploaded image is empty.")

    if len(data) > MAX_IMAGE_SIZE:
        raise ValueError("Image must be smaller than 20 MB.")

    return f"data:{mime};base64,{base64.b64encode(data).decode()}"


# =========================================================
# NORMALIZE RESULT
# =========================================================

def normalize_result(r):

    if not isinstance(r, dict):
        return None

    r["is_plant"] = bool(r.get("is_plant", True))
    r["crop"] = str(r.get("crop", "Unknown"))
    r["disease"] = str(r.get("disease", "Unknown"))

    try:
        r["confidence"] = max(
            0,
            min(
                100,
                round(float(r.get("confidence", 0)))
            )
        )
    except (ValueError, TypeError):
        r["confidence"] = 0

    if r.get("severity") not in {
        "Low", "Moderate", "High", "Unknown"
    }:
        r["severity"] = "Unknown"

    if r.get("image_quality") not in {
        "Good", "Fair", "Poor", "Unknown"
    }:
        r["image_quality"] = "Unknown"

    for key in [
        "symptoms",
        "possible_causes",
        "recommendations",
        "prevention"
    ]:
        value = r.get(key, [])
        if isinstance(value, str):
            value = [value]
        if not isinstance(value, list):
            value = []
        r[key] = [str(x).strip() for x in value if str(x).strip()]

    r["warning"] = str(r.get("warning", "")).strip()

    if not r["is_plant"]:
        r["crop"] = "Unknown"
        r["disease"] = "Not a plant image"
        r["severity"] = "Unknown"
        r["confidence"] = min(r["confidence"], 20)
        r["symptoms"] = []
        r["possible_causes"] = []
        r["recommendations"] = [
            "Upload a clear image of the affected plant or leaf."
        ]
        r["prevention"] = []
        r["warning"] = "Please upload a clear crop image."

    elif r["disease"].lower() == "healthy plant":
        r["disease"] = "Healthy Plant"

    elif r["disease"].lower() not in {
        "unknown",
        "unable to determine reliably"
    } and not r["disease"].lower().startswith("possible "):
        r["disease"] = "Possible " + r["disease"]

    if not r["warning"]:
        r["warning"] = (
            "This is an AI-based visual assessment, "
            "not a laboratory-confirmed diagnosis."
        )

    return r


# =========================================================
# MAIN DETECTION
# =========================================================

def detect_plant_disease(image_file, crop_name=""):

    api_key = os.getenv("GROQ_API_KEY")

    if not api_key:
        return {
            "success": False,
            "error": "GROQ_API_KEY is not configured."
        }

    try:
        image_url = image_to_data_url(image_file)

        crop = crop_name.strip() or "Unknown crop"

        prompt = f"""
You are Agrosathi AI, an agricultural plant-health assistant.

Crop: {crop}

Analyze the image carefully.

Determine:
- whether it is a plant/leaf
- crop name
- possible visible disease/problem
- confidence 0-100
- severity: Low, Moderate, High, Unknown
- image quality: Good, Fair, Poor, Unknown
- visible symptoms
- possible causes
- safe recommendations
- prevention
- warning

IMPORTANT:
This is only a visual AI assessment, not a laboratory diagnosis.
Do not claim a disease is confirmed.
Do not prescribe chemical pesticides or doses.
If evidence is weak, return Unknown.

Return ONLY valid JSON:

{{
  "is_plant": true,
  "crop": "Tomato",
  "disease": "Possible Early Blight",
  "confidence": 80,
  "severity": "Moderate",
  "image_quality": "Good",
  "symptoms": [],
  "possible_causes": [],
  "recommendations": [],
  "prevention": [],
  "warning": ""
}}
"""

        client = Groq(api_key=api_key)

        response = client.chat.completions.create(
            model=MODEL,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": prompt
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": image_url
                            }
                        }
                    ]
                }
            ],
            temperature=0.2,
            max_completion_tokens=1000,
            stream=False,
            response_format={
                "type": "json_object"
            }
        )

        content = response.choices[0].message.content

        if not content:
            return {
                "success": False,
                "error": "AI returned an empty response."
            }

        result = normalize_result(
            json.loads(content)
        )

        if result is None:
            return {
                "success": False,
                "error": "AI response could not be processed."
            }

        return {
            "success": True,
            **result
        }

    except json.JSONDecodeError:
        return {
            "success": False,
            "error": "AI returned invalid JSON."
        }

    except Exception as e:
        print("Disease detection error:", e)

        return {
            "success": False,
            "error": "Disease detection service is temporarily unavailable."
        }