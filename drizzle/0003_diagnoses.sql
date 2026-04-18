create table if not exists diagnoses (
   id               text primary key,
   farmer_id        text,
   image_key        text,
   diagnosis        text,
   confidence       text,
   gemini_response  text,
   feedback_correct integer,
   created_at       integer
);