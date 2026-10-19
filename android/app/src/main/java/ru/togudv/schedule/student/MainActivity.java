package ru.togudv.schedule.student;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    public static final String LOCKSCREEN_CHANNEL_ID = "togu_lockscreen_ongoing";
    public static final String ALERTS_CHANNEL_ID = "togu_lesson_alerts";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        createToguNotificationChannels();
    }

    private void createToguNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager == null) return;

            // 1. Постоянный канал для карточки расписания на экране блокировки (IMPORTANCE_LOW — без звука и вибрации)
            NotificationChannel ongoingChannel = new NotificationChannel(
                LOCKSCREEN_CHANNEL_ID,
                "Текущая и следующая пара (Экран блокировки)",
                NotificationManager.IMPORTANCE_LOW
            );
            ongoingChannel.setDescription("Постоянная карточка расписания ТОГУ на заблокированном экране Android");
            ongoingChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            ongoingChannel.setShowBadge(false);
            manager.createNotificationChannel(ongoingChannel);

            // 2. Канал напоминаний перед началом пары (IMPORTANCE_HIGH)
            NotificationChannel alertsChannel = new NotificationChannel(
                ALERTS_CHANNEL_ID,
                "Напоминания о начале пар и изменениях",
                NotificationManager.IMPORTANCE_HIGH
            );
            alertsChannel.setDescription("Уведомления за 5–30 минут до начала занятия и оповещения об отменах/переносах");
            alertsChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            manager.createNotificationChannel(alertsChannel);
        }
    }
}
