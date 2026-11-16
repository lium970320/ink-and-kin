package com.inkandkin.lanchat.media

import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import okhttp3.OkHttpClient
import java.util.ArrayDeque

data class QueuedVoiceItem(
    val messageId: Long,
    val resolvedUrl: String
)

@OptIn(markerClass = [UnstableApi::class])
class VoicePlayerManager(context: Context, mediaHttpClient: OkHttpClient) {

    private val appContext = context.applicationContext
    private val mediaSourceFactory = ProgressiveMediaSource.Factory(
        DefaultDataSource.Factory(appContext, OkHttpDataSource.Factory(mediaHttpClient))
    )
    private var mediaPlayer: ExoPlayer? = null
    private val autoQueue = ArrayDeque<QueuedVoiceItem>()

    private val _playingMessageId = MutableStateFlow<Long?>(null)
    val playingMessageId: StateFlow<Long?> = _playingMessageId.asStateFlow()

    private val _bufferingMessageId = MutableStateFlow<Long?>(null)
    val bufferingMessageId: StateFlow<Long?> = _bufferingMessageId.asStateFlow()

    @Synchronized
    fun togglePlay(messageId: Long, resolvedUrl: String) {
        autoQueue.clear()
        if (_playingMessageId.value == messageId || _bufferingMessageId.value == messageId) {
            stopAll()
            return
        }
        startSingle(messageId, resolvedUrl)
    }

    @Synchronized
    fun enqueueAutoPlay(messageId: Long, resolvedUrl: String) {
        if (resolvedUrl.isBlank()) return
        if (_playingMessageId.value == messageId || _bufferingMessageId.value == messageId) return
        if (autoQueue.any { it.messageId == messageId }) return

        if (_playingMessageId.value == null && _bufferingMessageId.value == null) {
            startSingle(messageId, resolvedUrl)
        } else {
            autoQueue.addLast(QueuedVoiceItem(messageId, resolvedUrl))
        }
    }

    @Synchronized
    fun stopIfPlaying(messageIds: Collection<Long>) {
        autoQueue.removeAll { it.messageId in messageIds }
        val current = _playingMessageId.value ?: _bufferingMessageId.value
        if (current != null && current in messageIds) {
            stopCurrentAndPlayNext()
        }
    }

    @Synchronized
    fun stopAll() {
        autoQueue.clear()
        releaseCurrentPlayer()
        _playingMessageId.value = null
        _bufferingMessageId.value = null
    }

    @Synchronized
    private fun startSingle(messageId: Long, resolvedUrl: String) {
        releaseCurrentPlayer()
        _playingMessageId.value = null
        _bufferingMessageId.value = messageId

        try {
            val player = ExoPlayer.Builder(appContext).build()
            mediaPlayer = player
            player.setAudioAttributes(
                AudioAttributes.Builder()
                    .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH)
                    .setUsage(C.USAGE_MEDIA)
                    .build(),
                true
            )
            player.addListener(object : Player.Listener {
                override fun onPlaybackStateChanged(playbackState: Int) {
                    synchronized(this@VoicePlayerManager) {
                        if (mediaPlayer !== player) return
                        when (playbackState) {
                            Player.STATE_BUFFERING -> {
                                _bufferingMessageId.value = messageId
                                _playingMessageId.value = null
                            }
                            Player.STATE_READY -> {
                                _bufferingMessageId.value = null
                                _playingMessageId.value = messageId
                            }
                            Player.STATE_ENDED -> stopCurrentAndPlayNext()
                            else -> Unit
                        }
                    }
                }

                override fun onPlayerError(error: PlaybackException) {
                    synchronized(this@VoicePlayerManager) {
                        if (mediaPlayer === player) {
                            stopCurrentAndPlayNext()
                        }
                    }
                }
            })
            player.setMediaSource(mediaSourceFactory.createMediaSource(MediaItem.fromUri(resolvedUrl)))
            player.prepare()
            player.play()
        } catch (_: Exception) {
            stopCurrentAndPlayNext()
        }
    }

    @Synchronized
    private fun stopCurrentAndPlayNext() {
        releaseCurrentPlayer()
        _playingMessageId.value = null
        _bufferingMessageId.value = null
        val next = autoQueue.pollFirst()
        if (next != null) {
            startSingle(next.messageId, next.resolvedUrl)
        }
    }

    private fun releaseCurrentPlayer() {
        val old = mediaPlayer
        mediaPlayer = null
        old?.release()
    }
}
