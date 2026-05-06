package com.smartmessages.android

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.View
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.work.*
import java.util.concurrent.TimeUnit

class MainActivity : AppCompatActivity() {

    private lateinit var etServerUrl: EditText
    private lateinit var etToken: EditText
    private lateinit var btnSync: Button
    private lateinit var tvStatus: TextView
    private lateinit var tvAutoSync: TextView
    private lateinit var progressBar: ProgressBar

    companion object {
        const val PREFS = "smartmessages"
        const val PERM_REQUEST = 100
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        etServerUrl  = findViewById(R.id.etServerUrl)
        etToken      = findViewById(R.id.etToken)
        btnSync      = findViewById(R.id.btnSync)
        tvStatus     = findViewById(R.id.tvStatus)
        tvAutoSync   = findViewById(R.id.tvAutoSync)
        progressBar  = findViewById(R.id.progressBar)

        val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
        etServerUrl.setText(prefs.getString("serverUrl", "https://smartmessages-zuul.onrender.com"))
        etToken.setText(prefs.getString("token", ""))

        val lastSync = prefs.getLong("lastSync", 0L)
        if (lastSync > 0L) {
            tvStatus.text = "Last sync: ${java.util.Date(lastSync)}\nTap button to sync again."
        }

        btnSync.setOnClickListener {
            saveConfig()
            requestPermissionsAndSync()
        }
    }

    private fun saveConfig() {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putString("serverUrl", etServerUrl.text.toString().trim().trimEnd('/'))
            .putString("token", etToken.text.toString().trim())
            .apply()
    }

    private fun requestPermissionsAndSync() {
        val needed = mutableListOf<String>()
        if (!hasPermission(Manifest.permission.READ_SMS)) needed.add(Manifest.permission.READ_SMS)
        if (!hasPermission(Manifest.permission.READ_CONTACTS)) needed.add(Manifest.permission.READ_CONTACTS)

        if (needed.isEmpty()) {
            startSync()
        } else {
            ActivityCompat.requestPermissions(this, needed.toTypedArray(), PERM_REQUEST)
        }
    }

    private fun hasPermission(perm: String) =
        ContextCompat.checkSelfPermission(this, perm) == PackageManager.PERMISSION_GRANTED

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == PERM_REQUEST) {
            if (hasPermission(Manifest.permission.READ_SMS)) {
                startSync()
            } else {
                tvStatus.text = "SMS permission is required to sync messages."
            }
        }
    }

    private fun startSync() {
        val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
        val serverUrl = prefs.getString("serverUrl", "").orEmpty()
        val token = prefs.getString("token", "").orEmpty()

        if (serverUrl.isEmpty() || token.isEmpty()) {
            tvStatus.text = "Please enter your server URL and sync token."
            return
        }

        btnSync.isEnabled = false
        progressBar.visibility = View.VISIBLE
        tvStatus.text = "Syncing…"

        val request = OneTimeWorkRequestBuilder<SmsSyncWorker>().build()
        val wm = WorkManager.getInstance(this)
        wm.enqueueUniqueWork("manual-sync", ExistingWorkPolicy.REPLACE, request)

        wm.getWorkInfoByIdLiveData(request.id).observe(this) { info ->
            if (info != null && info.state.isFinished) {
                btnSync.isEnabled = true
                progressBar.visibility = View.GONE

                val error = info.outputData.getString("error")
                if (error != null) {
                    tvStatus.text = "Error: $error"
                } else {
                    val accepted = info.outputData.getInt("accepted", 0)
                    val lastSync2 = getSharedPreferences(PREFS, MODE_PRIVATE).getLong("lastSync", 0L)
                    tvStatus.text = "Synced $accepted new messages.\nLast sync: ${java.util.Date(lastSync2)}"
                    scheduleAutoSync()
                    tvAutoSync.text = "Auto-sync active — runs every 15 minutes."
                }
            }
        }
    }

    private fun scheduleAutoSync() {
        val request = PeriodicWorkRequestBuilder<SmsSyncWorker>(15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
            "auto-sync",
            ExistingPeriodicWorkPolicy.UPDATE,
            request
        )
    }
}
