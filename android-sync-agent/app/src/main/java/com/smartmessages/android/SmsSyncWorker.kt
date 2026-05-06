package com.smartmessages.android

import android.Manifest
import android.content.ContentResolver
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.ContactsContract
import androidx.core.content.ContextCompat
import androidx.work.Data
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class SmsSyncWorker(context: Context, params: WorkerParameters) : Worker(context, params) {

    private val prefs = context.getSharedPreferences(MainActivity.PREFS, Context.MODE_PRIVATE)
    private val cr: ContentResolver = context.contentResolver

    override fun doWork(): Result {
        val serverUrl = prefs.getString("serverUrl", "").orEmpty().trimEnd('/')
        val token = prefs.getString("token", "").orEmpty()

        if (serverUrl.isEmpty() || token.isEmpty()) {
            return fail("Missing server URL or token")
        }
        if (!hasPermission(Manifest.permission.READ_SMS)) {
            return fail("No SMS permission")
        }

        return try {
            val lastSyncMs = prefs.getLong("lastSync", 0L)
            val messages = readSms(lastSyncMs)

            var totalAccepted = 0
            if (messages.isNotEmpty()) {
                messages.chunked(500).forEach { batch ->
                    totalAccepted += post(serverUrl, token, batch)
                }
                val latestMs = messages.maxOf { it.dateMs }
                prefs.edit().putLong("lastSync", latestMs).apply()
            }

            Result.success(Data.Builder().putInt("accepted", totalAccepted).build())
        } catch (e: Exception) {
            fail(e.message ?: "Unknown error")
        }
    }

    // ── SMS reading ───────────────────────────────────────────────────────────

    private data class Sms(
        val guid: String,
        val chatIdentifier: String,
        val displayName: String,
        val text: String?,
        val dateMs: Long,
        val isFromMe: Boolean,
        val isRead: Boolean,
        val senderHandle: String?
    )

    private fun readSms(sinceMs: Long): List<Sms> {
        val contactCache = mutableMapOf<String, String>()
        val result = mutableListOf<Sms>()

        val projection = arrayOf("_id", "address", "body", "date", "type", "read")
        cr.query(
            Uri.parse("content://sms/"),
            projection,
            "date > ?",
            arrayOf(sinceMs.toString()),
            "date ASC"
        )?.use { cursor ->
            val iId      = cursor.getColumnIndexOrThrow("_id")
            val iAddress = cursor.getColumnIndexOrThrow("address")
            val iBody    = cursor.getColumnIndexOrThrow("body")
            val iDate    = cursor.getColumnIndexOrThrow("date")
            val iType    = cursor.getColumnIndexOrThrow("type")
            val iRead    = cursor.getColumnIndexOrThrow("read")

            while (cursor.moveToNext()) {
                val address = cursor.getString(iAddress) ?: continue
                val phone   = normalizePhone(address)
                val name    = contactCache.getOrPut(phone) { lookupContact(address) ?: phone }

                result.add(Sms(
                    guid          = "android-sms-${cursor.getLong(iId)}",
                    chatIdentifier = phone,
                    displayName   = name,
                    text          = cursor.getString(iBody),
                    dateMs        = cursor.getLong(iDate),
                    isFromMe      = cursor.getInt(iType) == 2,  // 2 = sent
                    isRead        = cursor.getInt(iRead) == 1,
                    senderHandle  = if (cursor.getInt(iType) == 2) null else phone
                ))
            }
        }

        return result
    }

    private fun normalizePhone(phone: String): String {
        val stripped = phone.replace(Regex("[^0-9+]"), "")
        return stripped.ifEmpty { phone }
    }

    private fun lookupContact(phone: String): String? {
        if (!hasPermission(Manifest.permission.READ_CONTACTS)) return null
        val uri = Uri.withAppendedPath(
            ContactsContract.PhoneLookup.CONTENT_FILTER_URI,
            Uri.encode(phone)
        )
        cr.query(uri, arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME), null, null, null)
            ?.use { if (it.moveToFirst()) return it.getString(0) }
        return null
    }

    // ── HTTP POST ─────────────────────────────────────────────────────────────

    private fun post(serverUrl: String, token: String, messages: List<Sms>): Int {
        val array = JSONArray()
        messages.forEach { m ->
            array.put(JSONObject().apply {
                put("guid",                 m.guid)
                put("chat_identifier",      m.chatIdentifier)
                put("display_name",         m.displayName)
                put("service_name",         "SMS")
                put("text",                 if (m.text != null) m.text else JSONObject.NULL)
                put("date",                 m.dateMs / 1000.0)   // ms → seconds for server
                put("is_from_me",           m.isFromMe)
                put("is_read",              m.isRead)
                put("service",              "SMS")
                put("cache_has_attachments", false)
                put("sender_handle",        if (m.senderHandle != null) m.senderHandle else JSONObject.NULL)
            })
        }

        val body = JSONObject().put("messages", array).toString().toByteArray()
        val conn = (URL("$serverUrl/api/sync").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("x-sync-token", token)
            connectTimeout = 30_000
            readTimeout    = 30_000
            doOutput       = true
        }

        conn.outputStream.use { it.write(body) }

        if (conn.responseCode != 200) {
            val err = conn.errorStream?.bufferedReader()?.readText() ?: "no body"
            throw Exception("HTTP ${conn.responseCode}: $err")
        }

        return JSONObject(conn.inputStream.bufferedReader().readText()).getInt("accepted")
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun hasPermission(perm: String) =
        ContextCompat.checkSelfPermission(applicationContext, perm) == PackageManager.PERMISSION_GRANTED

    private fun fail(msg: String) =
        Result.failure(Data.Builder().putString("error", msg).build())
}
