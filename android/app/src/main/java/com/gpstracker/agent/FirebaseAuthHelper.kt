package com.gpstracker.agent

import android.util.Log
import com.google.firebase.auth.FirebaseAuth

/**
 * SÉCURITÉ — Les règles Firebase RTDB (firebase-rules.json) exigent désormais
 * `auth != null` pour écrire une position GPS (societes/{id}/agents/{id}) ou
 * lire un code société (companies/{code}) pendant l'onboarding.
 *
 * Avant ce correctif, ces chemins étaient ouverts à l'écriture/lecture sans
 * aucune authentification : n'importe qui pouvait injecter de fausses
 * positions GPS pour n'importe quel agent en connaissant/devinant son ID.
 *
 * Cet utilitaire garantit qu'une session Firebase Auth (même anonyme) existe
 * avant toute lecture/écriture RTDB sensible. Une fois la connexion anonyme
 * établie, elle est persistée par le SDK Firebase (stockage local de l'app),
 * donc les appels suivants dans l'app n'ont pas besoin de se reconnecter.
 */
object FirebaseAuthHelper {

    private const val TAG = "FirebaseAuthHelper"

    /**
     * Garantit qu'un utilisateur est connecté (même anonymement) avant d'exécuter [onReady].
     * Si un utilisateur est déjà connecté (anonyme ou non), [onReady] est appelé immédiatement,
     * de façon synchrone.
     */
    fun ensureSignedIn(onReady: () -> Unit, onError: ((Exception) -> Unit)? = null) {
        val auth = FirebaseAuth.getInstance()
        val current = auth.currentUser
        if (current != null) {
            onReady()
            return
        }
        auth.signInAnonymously()
            .addOnSuccessListener {
                Log.d(TAG, "✅ Authentification anonyme Firebase réussie")
                onReady()
            }
            .addOnFailureListener { e ->
                Log.e(TAG, "❌ Échec de l'authentification anonyme Firebase: ${e.message}", e)
                onError?.invoke(e)
            }
    }
}
