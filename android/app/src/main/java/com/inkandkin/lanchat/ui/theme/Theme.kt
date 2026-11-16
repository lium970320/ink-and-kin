package com.inkandkin.lanchat.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

@Immutable
data class InkAndKinExtendedPalette(
    val pageBg: Color,
    val barBg: Color,
    val cardBg: Color,
    val cardBorder: Color,
    val userBubbleBg: Color,
    val userBubbleText: Color,
    val assistantBubbleBg: Color,
    val assistantBubbleBorder: Color,
    val assistantBubbleText: Color,
    val scenePaperBg: Color,
    val sceneAccentLine: Color,
    val narrationText: Color,
    val subtleText: Color,
    val onlineDot: Color,
    val warningDot: Color,
    val chipBg: Color,
    val chipContent: Color
)

private val LightExtendedPalette = InkAndKinExtendedPalette(
    pageBg = Color(0xFFFAF8F5),
    barBg = Color(0xFFF5F1EB),
    cardBg = Color(0xFFFFFFFF),
    cardBorder = Color(0xFFE9E2D8),
    userBubbleBg = Color(0xFF3B332C),
    userBubbleText = Color(0xFFFCF9F5),
    assistantBubbleBg = Color(0xFFFFFFFF),
    assistantBubbleBorder = Color(0xFFE8E0D5),
    assistantBubbleText = Color(0xFF26221E),
    scenePaperBg = Color(0xFFF5EFE6),
    sceneAccentLine = Color(0xFFB38E72),
    narrationText = Color(0xFF75685C),
    subtleText = Color(0xFF8A7E72),
    onlineDot = Color(0xFF3E825E),
    warningDot = Color(0xFFC2823A),
    chipBg = Color(0xFFEDE6DC),
    chipContent = Color(0xFF59493C)
)

private val DarkExtendedPalette = InkAndKinExtendedPalette(
    pageBg = Color(0xFF121316),
    barBg = Color(0xFF17191E),
    cardBg = Color(0xFF1B1D22),
    cardBorder = Color(0xFF2B2E37),
    userBubbleBg = Color(0xFF564335),
    userBubbleText = Color(0xFFF8F4EF),
    assistantBubbleBg = Color(0xFF1B1D22),
    assistantBubbleBorder = Color(0xFF2C3039),
    assistantBubbleText = Color(0xFFECE8E2),
    scenePaperBg = Color(0xFF181A20),
    sceneAccentLine = Color(0xFFC9A68B),
    narrationText = Color(0xFFA79C91),
    subtleText = Color(0xFF8E877F),
    onlineDot = Color(0xFF57AD7E),
    warningDot = Color(0xFFD99A52),
    chipBg = Color(0xFF24272F),
    chipContent = Color(0xFFDCC6B4)
)

val LocalInkAndKinPalette = staticCompositionLocalOf { LightExtendedPalette }

private val LightMaterialColors = lightColorScheme(
    primary = Color(0xFF8C6A52),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFEDE2D7),
    onPrimaryContainer = Color(0xFF3A281C),
    secondary = Color(0xFF6F5E50),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFEBE2D8),
    onSecondaryContainer = Color(0xFF2B2119),
    background = Color(0xFFFAF8F5),
    onBackground = Color(0xFF25211D),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF25211D),
    surfaceVariant = Color(0xFFF1ECE4),
    onSurfaceVariant = Color(0xFF6B6055),
    outline = Color(0xFFD8CFC3),
    outlineVariant = Color(0xFFE9E2D8),
    error = Color(0xFFB84A39),
    onError = Color(0xFFFFFFFF)
)

private val DarkMaterialColors = darkColorScheme(
    primary = Color(0xFFC9A68B),
    onPrimary = Color(0xFF2D1E13),
    primaryContainer = Color(0xFF4C382A),
    onPrimaryContainer = Color(0xFFF3E3D5),
    secondary = Color(0xFFBDB0A4),
    onSecondary = Color(0xFF28211B),
    secondaryContainer = Color(0xFF352F2A),
    onSecondaryContainer = Color(0xFFEAE0D6),
    background = Color(0xFF121316),
    onBackground = Color(0xFFECE8E2),
    surface = Color(0xFF1B1D22),
    onSurface = Color(0xFFECE8E2),
    surfaceVariant = Color(0xFF24272E),
    onSurfaceVariant = Color(0xFFA9A198),
    outline = Color(0xFF3B3F4A),
    outlineVariant = Color(0xFF2A2D36),
    error = Color(0xFFE57365),
    onError = Color(0xFF2E100C)
)

private val InkAndKinTypography = Typography(
    headlineSmall = TextStyle(
        fontSize = 23.sp,
        lineHeight = 30.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = (-0.2).sp
    ),
    titleLarge = TextStyle(
        fontSize = 19.sp,
        lineHeight = 26.sp,
        fontWeight = FontWeight.SemiBold
    ),
    titleMedium = TextStyle(
        fontSize = 16.sp,
        lineHeight = 22.sp,
        fontWeight = FontWeight.Medium
    ),
    bodyLarge = TextStyle(
        fontSize = 15.5.sp,
        lineHeight = 23.5.sp,
        fontWeight = FontWeight.Normal
    ),
    bodyMedium = TextStyle(
        fontSize = 14.sp,
        lineHeight = 20.sp,
        fontWeight = FontWeight.Normal
    ),
    labelLarge = TextStyle(
        fontSize = 13.5.sp,
        lineHeight = 18.sp,
        fontWeight = FontWeight.Medium
    ),
    labelMedium = TextStyle(
        fontSize = 12.sp,
        lineHeight = 16.sp,
        fontWeight = FontWeight.Normal
    )
)

@Composable
fun InkAndKinTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    val colorScheme = if (darkTheme) DarkMaterialColors else LightMaterialColors
    val extended = if (darkTheme) DarkExtendedPalette else LightExtendedPalette

    CompositionLocalProvider(LocalInkAndKinPalette provides extended) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = InkAndKinTypography,
            content = content
        )
    }
}
