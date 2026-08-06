/* ============================================================
   CONFIGURAÇÃO DO SUPABASE
   ============================================================ */

const SUPABASE_URL = 'https://mcexlbymipymyusiaefo.supabase.co';
const SUPABASE_KEY = 'sb_publishable_r3EAsgiX6CmOPmnX7TxstA_oImTOmIz';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);