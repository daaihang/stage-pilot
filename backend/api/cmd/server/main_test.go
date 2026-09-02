package main

import "testing"

func TestPasswordHash(t *testing.T) {
	hash, err := hashPassword("correct horse battery")
	if err != nil { t.Fatal(err) }
	if hash == "correct horse battery" || !verifyPassword(hash, "correct horse battery") { t.Fatal("password hash did not verify") }
	if verifyPassword(hash, "wrong password") { t.Fatal("wrong password verified") }
}

func TestNormalizeEmail(t *testing.T) {
	if got := normalizeEmail("  User@Example.COM "); got != "user@example.com" { t.Fatalf("got %q", got) }
}
