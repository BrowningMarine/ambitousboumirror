import BackupPanel from "@/components/BackupPanel";
import HeaderBox from "@/components/HeaderBox";
import StatisticsCalculator from "@/components/StatisticsCalculator";
import WebhookNotificationManager from "@/components/WebhookNotificationManager";

const Settings = async () => {
  return (
    <section className="home">
      <div className="home-content">
        <header className="home-header">
          <HeaderBox
            type="title"
            title="Settings"
            subtext="App Administator settings"
          />
        </header>
        <div className="space-y-8">
          <BackupPanel />
          <StatisticsCalculator />
          <WebhookNotificationManager />
        </div>
      </div>
    </section>
  );
};

export default Settings;
