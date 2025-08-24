(function(){
  const params = new URLSearchParams(window.location.search);
  window.APISPEEDTEST_CONFIG = {
    TIME_DISPLAY_MODE: (params.get('time') || 'relative'), // relative | absolute
    DISPLAY_TIMEZONE: (params.get('tz') || 'local'), // local | UTC
    ABSOLUTE_FORMAT: 'yyyy-MM-dd HH:mm:ss',
    NUMBER_PRECISION: Number(params.get('precision') || 3),
    HOMEPAGE_URL: (params.get('home') || 'https://akashagupta.com/'),
    ENABLE_VISITOR_COUNTER: (params.get('vc') || 'true') !== 'false'
  };
})();
