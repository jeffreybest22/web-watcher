<?php
/**
 * ww-auth.php — API d'authentification du dashboard Web Watcher (GitHub Pages).
 * Login mot de passe + OTP email (Resend) sur nouvel appareil, reset par OTP.
 * Stockage: fichier JSON prefixé PHP (inaccessible en direct) à côté de ce script.
 */

const ALLOWED_EMAILS = ['jeffreybest2@gmail.com'];
const RESEND_KEY     = 're_ALJvhBH6_LKVYk6HpoTpiyUJQmuXYYT15';
const MAIL_FROM      = 'Web Watcher <onboarding@resend.dev>';
const ALLOWED_ORIGIN = 'https://jeffreybest22.github.io';
const DEVICE_TTL     = 15552000; // 180 jours
const OTP_TTL        = 600;      // 10 min
const RESET_TTL      = 900;      // 15 min
const OTP_COOLDOWN   = 60;       // 1 envoi/min max
const DATA_FILE      = __DIR__ . '/ww-auth-data.php';

// ---- CORS ----
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin === ALLOWED_ORIGIN) {
    header('Access-Control-Allow-Origin: ' . ALLOWED_ORIGIN);
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    header('Access-Control-Max-Age: 86400');
}
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }
header('Content-Type: application/json; charset=utf-8');

function out($arr, $code = 200) { http_response_code($code); echo json_encode($arr); exit; }
function fail($msg, $code = 400) { out(['ok' => false, 'error' => $msg], $code); }

// ---- Stockage ----
function load_data() {
    if (!file_exists(DATA_FILE)) return null;
    $raw = file_get_contents(DATA_FILE);
    $nl = strpos($raw, "\n");
    return json_decode($nl === false ? '' : substr($raw, $nl + 1), true);
}
function save_data($d) {
    file_put_contents(DATA_FILE, "<?php http_response_code(404); exit; ?>\n" . json_encode($d), LOCK_EX);
}
$data = load_data();
if (!is_array($data)) {
    $data = [
        'secret' => bin2hex(random_bytes(32)),
        'password_hash' => null,
        'devices' => [],       // device_id => expiry ts
        'otp' => null,         // {hash, exp, tries, purpose}
        'reset' => null,       // {hash, exp}
        'fails' => ['count' => 0, 'ts' => 0],
        'otp_sent_at' => 0,
    ];
    save_data($data);
}

// ---- Helpers ----
function client_blocked(&$d) {
    if ($d['fails']['count'] >= 8 && time() - $d['fails']['ts'] < 3600) return true;
    if (time() - $d['fails']['ts'] >= 3600) $d['fails'] = ['count' => 0, 'ts' => 0];
    return false;
}
function note_fail(&$d) { $d['fails']['count']++; $d['fails']['ts'] = time(); save_data($d); }

function make_token($email, $device, $secret) {
    $exp = time() + DEVICE_TTL;
    $sig = hash_hmac('sha256', "$email|$device|$exp", $secret);
    return base64_encode("$email|$device|$exp|$sig");
}
function check_token($token, $device, $secret) {
    $parts = explode('|', base64_decode($token ?? '', true) ?: '');
    if (count($parts) !== 4) return null;
    [$email, $dev, $exp, $sig] = $parts;
    if ($dev !== $device || (int)$exp < time()) return null;
    if (!hash_equals(hash_hmac('sha256', "$email|$dev|$exp", $secret), $sig)) return null;
    return in_array($email, ALLOWED_EMAILS, true) ? $email : null;
}
function send_otp_email($email, $code, $purpose) {
    $subject = $purpose === 'reset' ? '🔑 Web Watcher — code de réinitialisation' : '🔐 Web Watcher — code de connexion';
    $html = "<h2>Web Watcher</h2><p>Ton code " . ($purpose === 'reset' ? 'de réinitialisation' : 'de connexion') . " :</p>"
          . "<p style='font-size:32px;font-weight:bold;letter-spacing:6px'>$code</p>"
          . "<p style='color:#888'>Valide 10 minutes. Si tu n'es pas à l'origine de cette demande, ignore cet email.</p>";
    $ch = curl_init('https://api.resend.com/emails');
    curl_setopt_array($ch, [
        CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . RESEND_KEY, 'Content-Type: application/json'],
        CURLOPT_POSTFIELDS => json_encode(['from' => MAIL_FROM, 'to' => [$email], 'subject' => $subject, 'html' => $html]),
    ]);
    curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return $status >= 200 && $status < 300;
}
function issue_otp(&$d, $email, $purpose) {
    if (time() - $d['otp_sent_at'] < OTP_COOLDOWN) fail('Attends un peu avant de redemander un code.', 429);
    $code = (string)random_int(100000, 999999);
    $d['otp'] = ['hash' => hash('sha256', $code), 'exp' => time() + OTP_TTL, 'tries' => 0, 'purpose' => $purpose];
    $d['otp_sent_at'] = time();
    save_data($d);
    if (!send_otp_email($email, $code, $purpose)) fail("Impossible d'envoyer l'email OTP.", 502);
}
function prune_devices(&$d) {
    $d['devices'] = array_filter($d['devices'], fn($exp) => $exp > time());
}

// ---- Routing ----
$in = json_decode(file_get_contents('php://input'), true) ?: [];
$action = $in['action'] ?? '';
$email  = strtolower(trim($in['email'] ?? ''));
$device = preg_replace('/[^a-zA-Z0-9_-]/', '', $in['device_id'] ?? '');

if (client_blocked($data)) fail('Trop de tentatives. Réessaie dans une heure.', 429);

switch ($action) {

case 'check': {
    $who = check_token($in['token'] ?? '', $device, $data['secret']);
    prune_devices($data);
    if (!$who || !isset($data['devices'][$device])) out(['ok' => false]);
    out(['ok' => true, 'email' => $who]);
}

case 'login': {
    if (!in_array($email, ALLOWED_EMAILS, true)) { note_fail($data); fail('Identifiants invalides.', 401); }
    if (!$device) fail('device_id manquant.');
    // Premier setup : aucun mot de passe défini → OTP direct puis définition
    if (empty($data['password_hash'])) {
        issue_otp($data, $email, 'setup');
        out(['ok' => false, 'otp_required' => true, 'setup' => true]);
    }
    if (!password_verify($in['password'] ?? '', $data['password_hash'])) {
        note_fail($data); fail('Identifiants invalides.', 401);
    }
    prune_devices($data);
    if (isset($data['devices'][$device])) {
        $data['devices'][$device] = time() + DEVICE_TTL; // prolonge
        save_data($data);
        out(['ok' => true, 'token' => make_token($email, $device, $data['secret'])]);
    }
    // Nouvel appareil → OTP
    issue_otp($data, $email, 'login');
    out(['ok' => false, 'otp_required' => true]);
}

case 'verify-otp': {
    if (!in_array($email, ALLOWED_EMAILS, true) || !$device) fail('Requête invalide.');
    $otp = $data['otp'];
    if (!$otp || $otp['exp'] < time()) fail('Code expiré, redemande un code.', 401);
    if ($otp['tries'] >= 5) { $data['otp'] = null; save_data($data); fail('Trop d\'essais, redemande un code.', 429); }
    if (!hash_equals($otp['hash'], hash('sha256', trim($in['code'] ?? '')))) {
        $data['otp']['tries']++; save_data($data); fail('Code incorrect.', 401);
    }
    $purpose = $otp['purpose'];
    $data['otp'] = null;
    prune_devices($data);
    $data['devices'][$device] = time() + DEVICE_TTL;
    $resp = ['ok' => true, 'token' => make_token($email, $device, $data['secret'])];
    if ($purpose === 'setup' || $purpose === 'reset') {
        $rt = bin2hex(random_bytes(24));
        $data['reset'] = ['hash' => hash('sha256', $rt), 'exp' => time() + RESET_TTL];
        $resp['set_password'] = true;
        $resp['reset_token'] = $rt;
    }
    save_data($data);
    out($resp);
}

case 'forgot': {
    if (!in_array($email, ALLOWED_EMAILS, true)) fail('Email inconnu.', 401);
    issue_otp($data, $email, 'reset');
    out(['ok' => true, 'otp_sent' => true]);
}

case 'set-password': {
    $r = $data['reset'];
    $rt = $in['reset_token'] ?? '';
    if (!$r || $r['exp'] < time() || !hash_equals($r['hash'], hash('sha256', $rt))) fail('Session de réinitialisation expirée.', 401);
    $pw = $in['new_password'] ?? '';
    if (strlen($pw) < 8) fail('Mot de passe trop court (8 caractères minimum).');
    $data['password_hash'] = password_hash($pw, PASSWORD_DEFAULT);
    $data['reset'] = null;
    $data['fails'] = ['count' => 0, 'ts' => 0];
    save_data($data);
    out(['ok' => true]);
}

case 'logout': {
    if ($device && isset($data['devices'][$device])) { unset($data['devices'][$device]); save_data($data); }
    out(['ok' => true]);
}

default: fail('Action inconnue.', 404);
}
