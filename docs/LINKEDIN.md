# LinkedIn post

Murugan is a mason in Chennai. He works 11-hour days, often seven days a week. Every hour he works is written in a paper register he never gets to see.

When his pay comes, he can't tell if his overtime was counted. When the safety net on the 4th floor tore, he didn't report it, because everyone would know it was him.

He isn't rare. India has 5.65 crore construction workers registered with state welfare boards, and about 1 in 4 casual workers is paid below the legal minimum wage. Falls from height cause around 60% of construction accidents.

**The problem:** the people who build our towers and run our hospitals and campuses still live on paper registers and WhatsApp groups. They can't verify their pay, can't speak up safely, and their experience restarts at zero with every new job.

**What I built for #PromptWars: FairShift.**
🎙 Murugan holds one button and asks in Tamil, "Why is my pay low?" Gemini answers from his real hours, out loud. 16 Indian languages, and nobody has to type.
🧾 Every shift becomes a tamper-evident receipt. If his hours are edited later, he sees it, with the reason.
📸 He photographs the torn net. Gemini rates it "fix today", and his manager sees it live. Anonymous if he wants.
🛑 When his supervisor tries to give him a night shift after only 6 hours of rest, FairShift blocks it and suggests a rested colleague.
📒 His employer photographs the old register once. Gemini reads the handwriting and finds the overtime nobody paid.

**How it fits SDG 8:** on a 200-worker site, if the 1 in 4 who are underpaid each recover 6 hours of overtime a week, that's about ₹2.5 lakh a month back in workers' pockets. Employers adopt it because it produces the attendance, overtime and wage registers labour law already requires. One engine runs construction sites, hospitals and college campuses.

Built entirely on Google Cloud: Cloud Run, Gemini 3.8 Flash and Gemini 4 Argon on Vertex AI, Cloud Text-to-Speech and Firestore.

🔗 Try it live: https://fairshift-85398896185.asia-south1.run.app/#/demo
💻 Code: https://github.com/rehaanajani/fairshift

Thank you, ACM SRM and Hack2Skill.

#PromptWars #SDG8 #DecentWork #GoogleCloud #Gemini #VertexAI #CloudRun #BuildWithAI #ACMSRM

_Sources: state construction welfare board registrations (2025); PLFS-based minimum-wage study; Gujarat construction accident records (RTI). ₹2.5 lakh is an illustrative estimate: 50 workers × 6 h × 4.33 weeks × ₹190 overtime rate._
