# FairShift: two-minute split-screen demo

Open `/#/demo` on the deployed app, with the worker phone view beside the employer dashboard. Keep both panes visible throughout so the audience can connect a worker action to the employer's response.

## Before the timer starts

- Confirm `/#/demo` renders both panes and they can be used independently. The route embeds `/#/worker?embed` and `/#/admin?embed`, with separate worker and admin sessions. Rehearse the live provider calls before presenting.
- Select **Orion Builders / construction** and **Murugan S** on the worker side. If login is needed, use worker phone `9000000001`, PIN `1234`; Orion admin PIN `4321`. Set the worker language to Tamil and allow microphone access.
- Use a demo instance with working Vertex AI credentials for register-photo extraction, photo understanding and voice transcription, plus Cloud Text-to-Speech access for spoken answers. Test the microphone and speaker once. Automated tests run with `FAIRSHIFT_AI=off`; this live AI demo requires it enabled. Never expose credentials on screen.
- Have two synthetic photos ready: a legible paper attendance page using existing demo worker names and recent dates, and an obvious workplace hazard such as an exposed wire. Use a register row with 08:00–20:00 local times to make overtime visible. Avoid actual worker records or identifiable people.
- Rehearse the roster slot: choose a worker who is on shift or would have less than ten hours of rest, and confirm at least one rested replacement is suggested. Keep the worker and time ready to select. Prepare an existing completed-shift receipt code for verification.
- Check that employer live events are connected. Rehearse photo uploads and provider response times so the timed portion stays within two minutes. Reset demo data between rehearsals if repeated imports or planned shifts change the scenario.

## Timed run

| Time | Action on screen | Say |
| --- | --- | --- |
| **0:00–0:10** | Show both panes, with construction selected. | “FairShift connects the worker's phone to the employer's dashboard. We start with a familiar problem: attendance on paper, overtime that's hard to check, and safety concerns that get lost.” |
| **0:10–0:30** | In the admin pane, click **Import paper register → Choose or take a photo**. Select the register image. Point to imported shifts, overtime findings and receipts, then close the modal. | “A photo turns the register into shift records. Gemini reads the handwriting; deterministic rules calculate hours and overtime. Each imported shift receives a verifiable receipt.” |
| **0:30–0:48** | On the worker side, ask in Tamil: **“என் சம்பளம் எவ்வளவு? ஓவர்டைம் எப்படி கணக்கிடப்படுகிறது?”** Play the answer. Translation: “How much is my pay? How is overtime calculated?” | “The worker asks in Tamil and hears an explanation grounded in their own pay records. They don't need to decode a spreadsheet.” |
| **0:48–1:10** | Submit the hazard photo from the worker pane, with a short description and anonymous reporting selected. Point to the new alert on the admin side, then the tracking code on the worker side. | “A worker can show a danger instead of finding the right words. The employer sees the report live. The worker keeps a tracking code without attaching their name.” |
| **1:10–1:30** | In the admin pane, click the tired worker's **Plan** button, enter the rehearsed time, then **Check rest rules and plan**. Show the refusal, then click a replacement under **Rested colleagues who can take it**. | “FairShift checks rest before saving a shift. This assignment is blocked, with an explanation and available colleagues. We choose a replacement rather than overriding the warning.” |
| **1:30–1:47** | Click a prepared `FS-XXXX-XXXX` link under **Latest receipts**; it opens `/#/r/FS-XXXX-XXXX` in a new tab. Show valid status and hours, then return to the split screen. | “These hours have a hash-chained receipt. Corrections create a new receipt with a reason; the original record remains verifiable and is marked corrected.” |
| **1:47–2:00** | Use the employer pane's **Switch workplace** dropdown: **Orion Builders → CityCare Hospital → Campus Services, SRM**. Point to the sector and policy changes. | “The same foundation serves a building site, a hospital and a college: clear pay, adequate rest and a safer way to speak up. That's our contribution to SDG 8.” |

## Recovery cues

- If voice recording fails, type the Tamil question into the same assistant. Explain that this is the text path; do not present it as successful transcription. With AI disabled, rules can classify the pay intent, but a fluent Tamil spoken explanation is not guaranteed.
- If a photo service is unavailable, show a clearly labelled result from rehearsal and continue with the live text-report path. Register-photo import needs Gemini and has no rule-based extraction fallback.
- If the hazard alert does not arrive, refresh the admin overview to find the submitted report and say that live updates did not connect. Keep the tracking code visible.
- If the chosen roster slot is no longer blocked, use the rehearsed worker/time combination again; do not claim a warning that the app did not return. Switching the employer does not switch the worker session: for a longer industry-specific walkthrough, log the worker out from their skill-passport tab and choose Priya M for CityCare or Selvi K for Campus Services.
