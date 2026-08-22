import {
  SITE_MAINTENANCE_CSS,
  renderMaintenanceMarkup,
} from "@/lib/site-maintenance";

export default function SiteMaintenanceOverlay() {
  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `html, body { overflow: hidden !important; }
${SITE_MAINTENANCE_CSS}`,
        }}
      />
      <div dangerouslySetInnerHTML={{ __html: renderMaintenanceMarkup() }} />
    </>
  );
}
