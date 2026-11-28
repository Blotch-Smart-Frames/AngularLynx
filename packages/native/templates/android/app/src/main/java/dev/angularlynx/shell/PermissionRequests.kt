package dev.angularlynx.shell

/**
 * Asks the person for runtime permissions on a native module's behalf.
 *
 * Android's permission prompt belongs to an activity, and an activity has to
 * register for its result as it's created, before a module that wants it
 * exists. So MainActivity registers once and lends the prompt to whichever
 * module asks, which it hands this as its param. It's generic, so a module
 * that needs a permission later reuses it rather than adding a launcher of
 * its own.
 */
interface PermissionHost {
    /**
     * Shows Android's prompt for [names] and calls [done] once, on the main
     * thread, with whether each was granted. Must be called on the main
     * thread. Returns false, without asking, while another request is open:
     * the activity shows one prompt at a time.
     *
     * Android answers at once, without a prompt, for a permission the person
     * already granted or refused for good, and for one the manifest doesn't
     * declare (which counts as refused).
     */
    fun requestPermissions(names: Array<String>, done: (Map<String, Boolean>) -> Unit): Boolean
}
