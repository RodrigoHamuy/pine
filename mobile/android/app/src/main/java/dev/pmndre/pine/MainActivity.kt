package dev.pmndre.pine

import android.content.pm.ApplicationInfo
import android.os.Bundle
import android.webkit.WebView
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
	override fun onCreate(savedInstanceState: Bundle?) {
		registerPlugin(PinePlugin::class.java)
		super.onCreate(savedInstanceState)
		// A debug build's page can be looked at from the computer (the smoke run checks the page's
		// hardening that way); a release build's never, as capacitor.config.json says.
		if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) WebView.setWebContentsDebuggingEnabled(true)
	}
}
