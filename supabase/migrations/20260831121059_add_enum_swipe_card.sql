-- Parte 1: Adiciona 'swipe_card' ao enum question_type
ALTER TYPE public.question_type ADD VALUE IF NOT EXISTS 'swipe_card';
