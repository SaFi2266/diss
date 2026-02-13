<?php
/**
 * Plugin Name: Student Registry Sync - Diwaniya Industrial
 * Description: مزامنة بيانات الطلبة من تطبيق PWA وإتاحة البحث عن رقم السجل والصفحة فقط.
 * Version: 1.0.0
 */

if (!defined('ABSPATH')) exit;

class Diw_Student_Registry_Sync {
  private $table;
  function __construct() {
    global $wpdb;
    $this->table = $wpdb->prefix . 'diw_students';
    register_activation_hook(__FILE__, [$this, 'activate']);
    add_action('admin_menu', [$this, 'menu']);
    add_action('admin_init', [$this, 'register_settings']);
    add_shortcode('diw_student_search', [$this, 'shortcode']);
    add_action('wp_ajax_nopriv_diw_student_search', [$this, 'ajax_search']);
    add_action('wp_ajax_diw_student_search', [$this, 'ajax_search']);
    add_action('diw_sync_cron', [$this, 'sync_now']);
    if (!wp_next_scheduled('diw_sync_cron')) wp_schedule_event(time() + 120, 'hourly', 'diw_sync_cron');
  }

  function activate() {
    global $wpdb;
    $charset = $wpdb->get_charset_collate();
    $sql = "CREATE TABLE {$this->table} (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      roll_id VARCHAR(20) NOT NULL,
      full_name VARCHAR(255) NOT NULL,
      registry_number INT NOT NULL,
      registry_page INT NOT NULL,
      updated_at DATETIME NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY roll_id (roll_id),
      KEY full_name (full_name)
    ) $charset;";
    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    dbDelta($sql);
  }

  function menu() {
    add_options_page('Student Sync', 'Student Sync', 'manage_options', 'diw-sync', [$this, 'settings_page']);
  }

  function register_settings() {
    register_setting('diw_sync', 'diw_sync_api_url');
    register_setting('diw_sync', 'diw_sync_api_key');
    register_setting('diw_sync', 'diw_sync_captcha', ['default' => 0]);
  }

  function settings_page() {
    if (!current_user_can('manage_options')) return;
    if (isset($_POST['sync_now'])) $this->sync_now();
    echo '<div class="wrap"><h1>Student Registry Sync</h1><form method="post" action="options.php">';
    settings_fields('diw_sync');
    echo '<table class="form-table"><tr><th>API URL</th><td><input name="diw_sync_api_url" value="' . esc_attr(get_option('diw_sync_api_url')) . '" class="regular-text"></td></tr>';
    echo '<tr><th>API Key</th><td><input name="diw_sync_api_key" value="' . esc_attr(get_option('diw_sync_api_key')) . '" class="regular-text"></td></tr>';
    echo '<tr><th>Captcha</th><td><input type="checkbox" name="diw_sync_captcha" value="1" ' . checked(1, (int)get_option('diw_sync_captcha'), false) . '> تفعيل</td></tr></table>';
    submit_button();
    echo '</form><form method="post">'; submit_button('Sync Now', 'secondary', 'sync_now'); echo '</form></div>';
  }

  function sync_now() {
    $url = trailingslashit(get_option('diw_sync_api_url')) . 'students';
    if (!$url) return;
    $response = wp_remote_get($url, ['timeout' => 20, 'headers' => ['X-API-Key' => get_option('diw_sync_api_key')]]);
    if (is_wp_error($response)) return;
    $data = json_decode(wp_remote_retrieve_body($response), true);
    if (empty($data['items'])) return;
    global $wpdb;
    foreach ($data['items'] as $s) {
      $full = trim(($s['FirstName'] ?? '') . ' ' . ($s['FatherName'] ?? '') . ' ' . ($s['GrandFatherName'] ?? '') . ' ' . ($s['FourthName'] ?? ''));
      $wpdb->replace($this->table, [
        'roll_id' => sanitize_text_field($s['RollNumberID'] ?? ''),
        'full_name' => sanitize_text_field($full),
        'registry_number' => intval($s['RegistryNumber'] ?? 0),
        'registry_page' => intval($s['RegistryPage'] ?? 0),
        'updated_at' => current_time('mysql')
      ]);
    }
  }

  function shortcode() {
    ob_start();
    $nonce = wp_create_nonce('diw_search_nonce');
    echo '<div id="diw-search"><input id="diw-q" placeholder="ابحث عن اسم الطالب"><button id="diw-btn">بحث</button><div id="diw-res"></div></div>';
    echo '<script>document.getElementById("diw-btn").onclick=async function(){const q=document.getElementById("diw-q").value;const fd=new FormData();fd.append("action","diw_student_search");fd.append("nonce","'.$nonce.'");fd.append("q",q);const r=await fetch("'.admin_url('admin-ajax.php').'",{method:"POST",body:fd});const j=await r.json();document.getElementById("diw-res").innerHTML=(j.data||[]).map(x=>`<div>${x.full_name} - سجل ${x.registry_number} / صفحة ${x.registry_page}</div>`).join("");};</script>';
    return ob_get_clean();
  }

  function rate_limit_check() {
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    $key = 'diw_rate_' . md5($ip);
    $hits = (int)get_transient($key);
    if ($hits > 30) return false;
    set_transient($key, $hits + 1, MINUTE_IN_SECONDS);
    return true;
  }

  function ajax_search() {
    check_ajax_referer('diw_search_nonce', 'nonce');
    if (!$this->rate_limit_check()) wp_send_json_error(['message' => 'Too many requests'], 429);
    global $wpdb;
    $q = sanitize_text_field($_POST['q'] ?? '');
    if (strlen($q) < 2) wp_send_json_success([]);
    $like = '%' . $wpdb->esc_like($q) . '%';
    $rows = $wpdb->get_results($wpdb->prepare("SELECT full_name, registry_number, registry_page FROM {$this->table} WHERE full_name LIKE %s LIMIT 25", $like), ARRAY_A);
    wp_send_json_success($rows);
  }
}

new Diw_Student_Registry_Sync();
