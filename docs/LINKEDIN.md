# LinkedIn post draft

**Problem**

For shift workers, a long day can end with unanswered questions: Was my overtime counted? Why was money deducted? Can I report a hazard without putting my job at risk?

Language barriers and scattered attendance records make those questions harder to resolve. Employers also need a clearer view of unsafe workloads and concerns that never reach a supervisor.

**What we built**

FairShift is our prototype for decent work: site check-ins, explainable payslips, fatigue warnings, anonymous hazard reporting, worker feedback and skill records.

Pay calculations use testable rules. Gemini on Vertex AI helps explain the numbers and triage reports, with rule-based fallbacks. Workers can use multilingual text and browser speech; Sarvam speech and Firestore adapters provide the next integration path.

Feedback averages stay hidden until a topic has at least three entries. Admin access is scoped to the employer, and anonymous hazard reports omit the reporter's identity.

**How it fits**

Built around UN SDG 8, FairShift connects worker clarity with practical employer action across construction sites, hospitals and college services. Our Google Cloud deployment target is Cloud Run: a shared foundation for clearer pay, safer shifts and better conversations at work.

#PromptWars #SDG8 #GoogleCloud
