package dev.angularlynx.shell

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/**
 * Where the app's shortcuts point (`res/xml/shortcuts.xml`): it passes the
 * shortcut on to MainActivity and is gone before it draws anything.
 *
 * A shortcut can't point at MainActivity itself. Android starts a static
 * shortcut's activity with FLAG_ACTIVITY_CLEAR_TASK, which can't be changed,
 * so it would end the open MainActivity, and the running Angular app with
 * it, before starting a new one: every shortcut would restart the app. This
 * activity has a task of its own for Android to clear (`taskAffinity=""` in
 * the manifest), and starts MainActivity the ordinary way, which brings the
 * open one to the front and hands it the shortcut in onNewIntent. It's the
 * trampoline Android's shortcut guide describes.
 */
class ShortcutActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        startActivity(
            Intent(this, MainActivity::class.java).apply {
                intent.extras?.let { putExtras(it) }
                // MainActivity lives in another task than this one.
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            },
        )
        // Theme.NoDisplay needs the activity finished before it would resume.
        finish()
    }
}
