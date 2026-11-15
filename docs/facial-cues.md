# Facial cues: research only, excluded from the demo

OpenFace can estimate observable facial behavior such as landmarks, gaze, and
facial action units. That does not establish that someone is stressed, hostile,
or dangerous. A context-specific correlation cannot be used as an individual
stress detector for strangers on a moving FaceTime camera.

Research worth reviewing:

- [OpenFace 3.0](https://arxiv.org/abs/2506.02891) describes a multitask facial
  analysis system, including landmarks, action units, gaze, and expression tasks.
- [Detection of arousal and valence from facial expressions and physiological
  responses evoked by different types of stressors](https://pmc.ncbi.nlm.nih.gov/articles/PMC10978716/)
  studies combined signals under experimental conditions; its OpenFace processing
  excludes low-confidence samples and aggregates features over time.
- [How nervous am I?](https://www.tandfonline.com/doi/full/10.1080/02699931.2023.2229545)
  investigates anxiety prediction from dynamic facial behavior in a particular
  study setting. It does not validate general-purpose danger alerts in public.

A future opt-in study should measure visible actions, such as a sustained brow
movement, without assigning emotion or intent. Establish a consenting person's
baseline, reject poor tracking, evaluate across lighting and head poses, and
let the user disable it. Do not send “extreme reaction” warnings based on an
unvalidated emotion label. Current Aurora prompts explicitly exclude these
inferences, and no facial-cue pipeline is active.
