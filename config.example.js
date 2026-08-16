/* ============================================================
   CONFIGURAÇÃO DO SUPABASE — MODELO
   ============================================================
   Copie este arquivo para "config.js" e preencha com os dados
   do seu projeto Supabase (Project Settings → API).
   ============================================================ */

const SUPABASE_URL = 'https://SEU-PROJETO.supabase.co';
const SUPABASE_KEY = 'sua-chave-publishable-aqui';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
