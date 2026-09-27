<?php
// DB connection + shared constants for the PHP API that replaces Supabase.
// Adjust these if your XAMPP MySQL credentials differ.

const DB_HOST = '127.0.0.1';
const DB_NAME = 'aurai_forecast';
const DB_USER = 'root';
const DB_PASS = '';

const SESSION_TTL_DAYS = 30;

function db(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $dsn = "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=utf8mb4";
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
    }
    return $pdo;
}
