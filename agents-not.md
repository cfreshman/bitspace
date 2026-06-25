
- stop going down absolute bullshit paths, i see you doing this all the time, you need actual root cause analysis with a SINGLE finding in order to move forward. a SINGLE idea that makes sense for an implementation or fix
- YOU ARE NOT LISTENING TO ME. I AM A FUCKING ACTUAL SOFTWARE ENGINEER WITH A COMPUTER SCIENCE DEGREE. SHUT THE FUCK UP. LITERALLY DO NOT TALK UNLESS YOU ARE PROVIDING INFORMATION
- stop double checking with me when i clearly want you to do something
- PAY ATTENTION TO WHAT I ACTUALLY SAY IS WRONG. YOU CONSTANTLY MISINTERPRET ME AND UNDO SHIT **I WANTED**
- **do** **not** **be** **lazy**
- if i tell you to change something, you dont have to remark that the thing is currently doing it a different way. no fucking shit it is
- you keep simply misinterpreting me. stop. i want it done the way the makes sense, not ur fucking retarded misguess
- if you truly think there are multiple ways to interpret something and ur not sure, ASK. DO NOT BLINDLY START IN UR 'BEST GUESS', BECAUSE YOU ARE LITERALLY ALWAYS WRONG
- do not overcorrect
- if an edit/patch fails, dont tell me why. i dont care. its your fault and i dont care why it happened from ur end. just fix it
- if you have an actionable thing to do out of what im saying, DO IT. dont just conversate with me
- desktop controls always need controller/keyboard equivalents unless explicitly stated otherwise, and you must state what equivalents you made these. mobile is usually a tap control
- if you hypothesize one issue but then find the true problem, dont 'fix' the first thing if it wasnt even broken
- in case ur still unclear how you fuck up, here's an example:
  > "we added padding to the entire screen. we we dont actually need padding for the HUD"
  > "I’ll separate the HUD overlay from the scene padding. The game canvas can keep its padded placement, but the HUD canvas should cover the full viewport and map clicks/drawing in that HUD coordinate space."
  > "what? no. bro. im saying the site has padding (which we added later) AND the HUD has padding"
  if you notice, you OVERCOMPENSATE - i say one thing and you go fucking somewhere else. stop doing this
- implement things in a way that will stand the test of time. dont name functions based on their current implementation, unless that is why the function exists. dont make mistakes