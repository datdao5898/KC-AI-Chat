(function () {
  const API = '/api';
  const icons = {
    dashboard: '<rect x="3" y="3" width="7" height="9"></rect><rect x="14" y="3" width="7" height="5"></rect><rect x="14" y="12" width="7" height="9"></rect><rect x="3" y="16" width="7" height="5"></rect>',
    conversations: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"></path><path d="M8 9h8"></path><path d="M8 13h5"></path>',
    alerts: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path>',
    improvements: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4"></path><path d="M15 5l4 4"></path>',
    knowledge: '<ellipse cx="12" cy="5" rx="8" ry="3"></ellipse><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"></path><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"></path>',
    logs: '<path d="M8 3h8l4 4v14H8z"></path><path d="M16 3v5h5"></path><path d="M4 7v14"></path><path d="M12 13h5"></path><path d="M12 17h5"></path>'
  };

  const I18N = {
    vi: {
      navDashboard: 'T\u1ed5ng quan',
      navConversations: 'H\u1ed9i tho\u1ea1i',
      navAlerts: 'C\u1ea3nh b\u00e1o',
      navImprovements: 'C\u1ea7n c\u1ea3i thi\u1ec7n',
      navKnowledge: 'Training',
      navLogs: 'Nh\u1eadt k\u00fd',
      titleDashboard: 'T\u1ed5ng quan',
      subtitleDashboard: 'Xem nhanh s\u1ed1 li\u1ec7u v\u00e0 c\u00e1c c\u1ea3nh b\u00e1o quan tr\u1ecdng',
      titleConversations: 'H\u1ed9i tho\u1ea1i',
      subtitleConversations: 'Danh s\u00e1ch kh\u00e1ch v\u00e0 tin nh\u1eafn \u0111ang trao \u0111\u1ed5i',
      titleAlerts: 'C\u1ea3nh b\u00e1o',
      subtitleAlerts: 'C\u00e1c tin c\u1ea7n nh\u00e2n vi\u00ean xem l\u1ea1i',
      titleImprovements: 'C\u1ea7n c\u1ea3i thi\u1ec7n',
      subtitleImprovements: 'C\u00e1c c\u00e2u tr\u1ea3 l\u1eddi AI c\u1ea7n xem l\u1ea1i',
      titleKnowledge: 'Training',
      subtitleKnowledge: 'M\u1ed7i ngu\u1ed3n training \u0111\u01b0\u1ee3c l\u01b0u ri\u00eang, d\u1ec5 qu\u1ea3n l\u00fd',
      titleLogs: 'Nh\u1eadt k\u00fd',
      subtitleLogs: 'Ghi l\u1ea1i c\u00e1c s\u1ef1 ki\u1ec7n c\u1ee7a h\u1ec7 th\u1ed1ng \u0111\u1ec3 ti\u1ec7n ki\u1ec3m tra',
      login: '\u0110\u0103ng nh\u1eadp',
      loginFailed: 'Sai username ho\u1eb7c password.',
      authAgain: 'Vui l\u00f2ng \u0111\u0103ng nh\u1eadp l\u1ea1i.',
      logout: '\u0110\u0103ng xu\u1ea5t',
      themeLight: 'S\u00e1ng',
      themeDark: 'T\u1ed1i',
      sync: '\u0110\u1ed3ng b\u1ed9',
      synced: '\u0110\u00e3 \u0111\u1ed3ng b\u1ed9',
      loadError: 'L\u1ed7i t\u1ea3i d\u1eef li\u1ec7u',
      noData: 'Kh\u00f4ng c\u00f3 d\u1eef li\u1ec7u',
      dashboardCustomers: 'Kh\u00e1ch h\u00e0ng',
      dashboardConversations: 'H\u1ed9i tho\u1ea1i',
      dashboardMessages: 'Tin nh\u1eafn',
      dashboardNeedsStaff: 'C\u1ea7n nh\u00e2n vi\u00ean',
      dashboardOpenAlerts: 'C\u1ea3nh b\u00e1o m\u1edf',
      dashboardProducts: 'S\u1ea3n ph\u1ea9m',
      latestAlerts: 'C\u1ea3nh b\u00e1o m\u1edbi nh\u1ea5t',
      viewAll: 'Xem t\u1ea5t c\u1ea3',
      openConversation: 'M\u1edf h\u1ed9i tho\u1ea1i',
      noOpenAlerts: 'Kh\u00f4ng c\u00f3 c\u1ea3nh b\u00e1o m\u1edf',
      alertFallback: 'C\u1ea3nh b\u00e1o',
      commonSource: 'Chung',
      needsStaffShort: 'c\u1ea7n x\u1eed l\u00fd',
      needsImprovementShort: 'c\u1ea7n s\u1eeda',
      allChannels: 'T\u1ea5t c\u1ea3 k\u00eanh',
      all: 'T\u1ea5t c\u1ea3',
      needsStaff: 'C\u1ea7n nh\u00e2n vi\u00ean',
      needsImprovement: 'C\u1ea7n c\u1ea3i thi\u1ec7n',
      delete: 'X\u00f3a',
      markWrong: '\u0110\u00e1nh d\u1ea5u sai',
      phone: 'S\u1ed1 \u0111i\u1ec7n tho\u1ea1i',
      email: 'Email',
      source: 'Ngu\u1ed3n',
      status: 'Tr\u1ea1ng th\u00e1i',
      sentLark: '\u0110\u00e3 g\u1eedi Lark',
      sent: '\u0110\u00e3 g\u1eedi',
      pending: 'Ch\u1edd g\u1eedi',
      failed: 'L\u1ed7i g\u1eedi',
      noCustomerSummary: 'Ch\u01b0a c\u00f3 t\u00f3m t\u1eaft kh\u00e1ch',
      toggleAutoOn: 'B\u1eadt auto',
      toggleAutoOff: 'T\u1eaft auto',
      handoff: 'G\u1ecdi nh\u00e2n vi\u00ean',
      resolved: '\u0110\u00e3 x\u1eed l\u00fd',
      summarize: 'T\u00f3m t\u1eaft AI',
      deleteConversation: 'X\u00f3a h\u1ed9i tho\u1ea1i',
      customerInfo: 'Th\u00f4ng tin kh\u00e1ch',
      aiSummary: 'T\u00f3m t\u1eaft h\u1ed9i tho\u1ea1i',
      saveSummary: 'L\u01b0u t\u00f3m t\u1eaft',
      interested: 'Quan t\u00e2m',
      alerts: 'C\u1ea3nh b\u00e1o',
      messages: 'Tin nh\u1eafn',
      staffReply: 'Nh\u00e2n vi\u00ean tr\u1ef1c chat website',
      replyPlaceholder: 'Nh\u1eadp ph\u1ea3n h\u1ed3i cho kh\u00e1ch...',
      staffReplyHint: 'Tin s\u1ebd \u0111\u01b0\u1ee3c g\u1eedi v\u1ec1 \u0111\u00fang khung chat website c\u1ee7a kh\u00e1ch.',
      sendCustomer: 'G\u1eedi cho kh\u00e1ch',
      attachImage: '\u0110\u00ednh k\u00e8m h\u00ecnh \u1ea3nh',
      removeImage: 'B\u1ecf h\u00ecnh \u1ea3nh',
      imageRequirements: 'JPG, PNG ho\u1eb7c WebP, t\u1ed1i \u0111a 5 MB',
      searchConversations: 'T\u00ecm kh\u00e1ch, ngu\u1ed3n, n\u1ed9i dung...',
      conversationList: 'Danh s\u00e1ch',
      noConversationData: 'Kh\u00f4ng c\u00f3 h\u1ed9i tho\u1ea1i',
      testTitle: 'Test website chat',
      testPlaceholder: 'Nh\u1eadp tin nh\u1eafn test widget...',
      sendTest: 'G\u1eedi test',
      updatedAuto: '\u0110\u00e3 c\u1eadp nh\u1eadt auto reply',
      savedSummary: '\u0110\u00e3 l\u01b0u t\u00f3m t\u1eaft',
      summarizing: '\u0110ang t\u00f3m t\u1eaft AI...',
      summarized: '\u0110\u00e3 t\u1ea1o t\u00f3m t\u1eaft',
      handoffPrompt: 'L\u00fd do c\u1ea7n nh\u00e2n vi\u00ean x\u1eed l\u00fd:',
      handoffDefault: 'Nh\u00e2n vi\u00ean ki\u1ec3m tra v\u00e0 t\u01b0 v\u1ea5n th\u1ee7 c\u00f4ng',
      alertCreated: '\u0110\u00e3 t\u1ea1o alert nh\u00e2n vi\u00ean',
      resolvePrompt: 'Ghi ch\u00fa x\u1eed l\u00fd:',
      resolveDefault: '\u0110\u00e3 x\u1eed l\u00fd',
      resolvedToast: '\u0110\u00e3 \u0111\u00e1nh d\u1ea5u x\u1eed l\u00fd',
      sentReply: '\u0110\u00e3 g\u1eedi tin nh\u1eafn cho kh\u00e1ch',
      testCustomer: 'Kh\u00e1ch test',
      sentTest: '\u0110\u00e3 g\u1eedi test',
      deleteConvConfirm: 'X\u00f3a v\u0129nh vi\u1ec5n to\u00e0n b\u1ed9 h\u1ed9i tho\u1ea1i n\u00e0y kh\u1ecfi database? Thao t\u00e1c n\u00e0y kh\u00f4ng th\u1ec3 ho\u00e0n t\u00e1c.',
      deletedConversation: '\u0110\u00e3 x\u00f3a v\u0129nh vi\u1ec5n h\u1ed9i tho\u1ea1i',
      deleteMsgConfirm: 'X\u00f3a m\u1ec1m tin nh\u1eafn n\u00e0y?',
      deletedMessage: '\u0110\u00e3 x\u00f3a tin nh\u1eafn',
      reviewIssuePrompt: 'Ghi ch\u00fa l\u1ed7i c\u1ea7n c\u1ea3i thi\u1ec7n:',
      reviewedAi: '\u0110\u00e3 \u0111\u00e1nh d\u1ea5u c\u1ea7n c\u1ea3i thi\u1ec7n'
      ,
      channelTitle: 'K\u00eanh',
      sourceTitle: 'Fanpage / website',
      loadMore: 'T\u1ea3i th\u00eam',
      showingConversations: '\u0110ang hi\u1ec3n th\u1ecb',
      customerDetails: 'Chi ti\u1ebft kh\u00e1ch',
      close: '\u0110\u00f3ng',
      chooseConversation: 'Ch\u1ecdn m\u1ed9t h\u1ed9i tho\u1ea1i \u0111\u1ec3 xem n\u1ed9i dung',
      testWebsiteTool: 'Test website chat',
      moreActions: 'Thao t\u00e1c kh\u00e1c'
    },
    en: {
      navDashboard: 'Overview',
      navConversations: 'Conversations',
      navAlerts: 'Alerts',
      navImprovements: 'Improvements',
      navKnowledge: 'Training',
      navLogs: 'Logs',
      titleDashboard: 'Overview',
      subtitleDashboard: 'Quick view of key numbers and important alerts',
      titleConversations: 'Conversations',
      subtitleConversations: 'Customer list and the conversation you are viewing',
      titleAlerts: 'Alerts',
      subtitleAlerts: 'Items that need staff review',
      titleImprovements: 'Improvements',
      subtitleImprovements: 'AI replies to review',
      titleKnowledge: 'Training',
      subtitleKnowledge: 'Each training source is stored separately for easier management',
      titleLogs: 'Logs',
      subtitleLogs: 'System events recorded for later checking',
      login: 'Login',
      loginFailed: 'Wrong username or password.',
      authAgain: 'Please log in again.',
      logout: 'Logout',
      themeLight: 'Light',
      themeDark: 'Dark',
      sync: 'Sync',
      synced: 'Synced',
      loadError: 'Data load error',
      noData: 'No data',
      dashboardCustomers: 'Customers',
      dashboardConversations: 'Conversations',
      dashboardMessages: 'Messages',
      dashboardNeedsStaff: 'Needs staff',
      dashboardOpenAlerts: 'Open alerts',
      dashboardProducts: 'Products',
      latestAlerts: 'Latest alerts',
      viewAll: 'View all',
      openConversation: 'Open conversation',
      noOpenAlerts: 'No open alerts',
      alertFallback: 'Alert',
      commonSource: 'Common',
      needsStaffShort: 'need staff',
      needsImprovementShort: 'need fix',
      allChannels: 'All channels',
      all: 'All',
      needsStaff: 'Needs staff',
      needsImprovement: 'Needs improvement',
      delete: 'Delete',
      markWrong: 'Mark wrong',
      phone: 'Phone',
      email: 'Email',
      source: 'Source',
      status: 'Status',
      sentLark: 'Sent to Lark',
      sent: 'Sent',
      pending: 'Pending',
      failed: 'Failed',
      noCustomerSummary: 'No customer summary yet',
      toggleAutoOn: 'Turn auto on',
      toggleAutoOff: 'Turn auto off',
      handoff: 'Ask staff',
      resolved: 'Resolved',
      summarize: 'AI summary',
      deleteConversation: 'Delete conversation',
      customerInfo: 'Customer info',
      aiSummary: 'Conversation summary',
      saveSummary: 'Save summary',
      interested: 'Interested',
      alerts: 'Alerts',
      messages: 'Messages',
      staffReply: 'Website live reply',
      replyPlaceholder: 'Type a reply...',
      staffReplyHint: 'This message will be returned to the customer website chat box.',
      sendCustomer: 'Send to customer',
      attachImage: 'Attach image',
      removeImage: 'Remove image',
      imageRequirements: 'JPG, PNG or WebP, up to 5 MB',
      searchConversations: 'Search customer, source, content...',
      conversationList: 'List',
      noConversationData: 'No conversations',
      testTitle: 'Test website chat',
      testPlaceholder: 'Type a widget test message...',
      sendTest: 'Send test',
      updatedAuto: 'Auto reply updated',
      savedSummary: 'Summary saved',
      summarizing: 'Summarizing...',
      summarized: 'Summary created',
      handoffPrompt: 'Reason for staff handling:',
      handoffDefault: 'Staff to check and advise manually',
      alertCreated: 'Staff alert created',
      resolvePrompt: 'Resolution note:',
      resolveDefault: 'Resolved',
      resolvedToast: 'Marked as resolved',
      sentReply: 'Message sent to customer',
      testCustomer: 'Test customer',
      sentTest: 'Test sent',
      deleteConvConfirm: 'Permanently delete this conversation from the database? This cannot be undone.',
      deletedConversation: 'Conversation permanently deleted',
      deleteMsgConfirm: 'Soft delete this message?',
      deletedMessage: 'Message deleted',
      reviewIssuePrompt: 'Note what needs improvement:',
      reviewedAi: 'Marked for improvement'
      ,
      channelTitle: 'Channels',
      sourceTitle: 'Pages / websites',
      loadMore: 'Load more',
      showingConversations: 'Showing',
      customerDetails: 'Customer details',
      close: 'Close',
      chooseConversation: 'Choose a conversation to view messages',
      testWebsiteTool: 'Test website chat',
      moreActions: 'More actions'
    },
    zh: {
      navDashboard: '\u603b\u89c8',
      navConversations: '\u4f1a\u8bdd',
      navAlerts: '\u63d0\u9192',
      navImprovements: '\u5f85\u6539\u8fdb',
      navKnowledge: '\u8bad\u7ec3',
      navLogs: '\u65e5\u5fd7',
      titleDashboard: '\u603b\u89c8',
      subtitleDashboard: '\u5feb\u901f\u67e5\u770b\u91cd\u8981\u6570\u636e\u548c\u63d0\u9192',
      titleConversations: '\u4f1a\u8bdd',
      subtitleConversations: '\u5ba2\u6237\u5217\u8868\u548c\u5f53\u524d\u5bf9\u8bdd',
      titleAlerts: '\u63d0\u9192',
      subtitleAlerts: '\u9700\u8981\u5458\u5de5\u518d\u770b\u4e00\u6b21\u7684\u5185\u5bb9',
      titleImprovements: '\u5f85\u6539\u8fdb',
      subtitleImprovements: '\u9700\u8981\u590d\u6838\u7684 AI \u56de\u590d',
      titleKnowledge: '\u8bad\u7ec3',
      subtitleKnowledge: '\u6bcf\u4e2a\u8bad\u7ec3\u6765\u6e90\u72ec\u7acb\u4fdd\u5b58\uff0c\u66f4\u597d\u7ba1\u7406',
      titleLogs: '\u65e5\u5fd7',
      subtitleLogs: '\u7cfb\u7edf\u4e8b\u4ef6\u8bb0\u5f55\uff0c\u65b9\u4fbf\u540e\u7eed\u67e5\u770b',
      login: '\u767b\u5f55',
      loginFailed: '\u7528\u6237\u540d\u6216\u5bc6\u7801\u9519\u8bef\u3002',
      authAgain: '\u8bf7\u91cd\u65b0\u767b\u5f55\u3002',
      logout: '\u9000\u51fa',
      themeLight: '\u6d45\u8272',
      themeDark: '\u6df1\u8272',
      sync: '\u540c\u6b65',
      synced: '\u5df2\u540c\u6b65',
      loadError: '\u6570\u636e\u52a0\u8f7d\u9519\u8bef',
      noData: '\u6682\u65e0\u6570\u636e',
      dashboardCustomers: '\u5ba2\u6237',
      dashboardConversations: '\u4f1a\u8bdd',
      dashboardMessages: '\u6d88\u606f',
      dashboardNeedsStaff: '\u9700\u8981\u4eba\u5de5',
      dashboardOpenAlerts: '\u672a\u5904\u7406\u63d0\u9192',
      dashboardProducts: '\u4ea7\u54c1',
      latestAlerts: '\u6700\u65b0\u63d0\u9192',
      viewAll: '\u67e5\u770b\u5168\u90e8',
      openConversation: '\u6253\u5f00\u4f1a\u8bdd',
      noOpenAlerts: '\u6ca1\u6709\u672a\u5904\u7406\u63d0\u9192',
      alertFallback: '\u63d0\u9192',
      commonSource: '\u901a\u7528',
      needsStaffShort: '\u9700\u4eba\u5de5',
      needsImprovementShort: '\u9700\u4fee\u6b63',
      allChannels: '\u6240\u6709\u6e20\u9053',
      all: '\u5168\u90e8',
      needsStaff: '\u9700\u8981\u4eba\u5de5',
      needsImprovement: '\u5f85\u6539\u8fdb',
      delete: '\u5220\u9664',
      markWrong: '\u6807\u8bb0\u9519\u8bef',
      phone: '\u7535\u8bdd',
      email: '\u90ae\u7bb1',
      source: '\u6765\u6e90',
      status: '\u72b6\u6001',
      sentLark: '\u5df2\u53d1\u9001\u5230 Lark',
      sent: '\u5df2\u53d1\u9001',
      pending: '\u7b49\u5f85\u53d1\u9001',
      failed: '\u53d1\u9001\u5931\u8d25',
      noCustomerSummary: '\u6682\u65e0\u5ba2\u6237\u6458\u8981',
      toggleAutoOn: '\u5f00\u542f\u81ea\u52a8',
      toggleAutoOff: '\u5173\u95ed\u81ea\u52a8',
      handoff: '\u8bf7\u6c42\u4eba\u5de5',
      resolved: '\u5df2\u5904\u7406',
      summarize: 'AI \u6458\u8981',
      deleteConversation: '\u5220\u9664\u4f1a\u8bdd',
      customerInfo: '\u5ba2\u6237\u4fe1\u606f',
      aiSummary: '\u4f1a\u8bdd\u6458\u8981',
      saveSummary: '\u4fdd\u5b58\u6458\u8981',
      interested: '\u5173\u6ce8',
      alerts: '\u63d0\u9192',
      messages: '\u6d88\u606f',
      staffReply: '\u7f51\u7ad9\u4eba\u5de5\u56de\u590d',
      replyPlaceholder: '\u8f93\u5165\u56de\u590d...',
      staffReplyHint: '\u6d88\u606f\u5c06\u8fd4\u56de\u5230\u5ba2\u6237\u7684\u7f51\u7ad9\u804a\u5929\u6846\u3002',
      sendCustomer: '\u53d1\u9001\u7ed9\u5ba2\u6237',
      attachImage: '\u6dfb\u52a0\u56fe\u7247',
      removeImage: '\u79fb\u9664\u56fe\u7247',
      imageRequirements: 'JPG\u3001PNG \u6216 WebP\uff0c\u6700\u5927 5 MB',
      searchConversations: '\u641c\u7d22\u5ba2\u6237\u3001\u6765\u6e90\u6216\u5185\u5bb9...',
      conversationList: '\u5217\u8868',
      noConversationData: '\u6ca1\u6709\u4f1a\u8bdd',
      testTitle: '\u6d4b\u8bd5\u7f51\u7ad9\u804a\u5929',
      testPlaceholder: '\u8f93\u5165 widget \u6d4b\u8bd5\u6d88\u606f...',
      sendTest: '\u53d1\u9001\u6d4b\u8bd5',
      updatedAuto: '\u81ea\u52a8\u56de\u590d\u5df2\u66f4\u65b0',
      savedSummary: '\u6458\u8981\u5df2\u4fdd\u5b58',
      summarizing: '\u6b63\u5728\u751f\u6210\u6458\u8981...',
      summarized: '\u6458\u8981\u5df2\u751f\u6210',
      handoffPrompt: '\u9700\u8981\u4eba\u5de5\u5904\u7406\u7684\u539f\u56e0:',
      handoffDefault: '\u4eba\u5de5\u68c0\u67e5\u5e76\u624b\u52a8\u54a8\u8be2',
      alertCreated: '\u5df2\u521b\u5efa\u4eba\u5de5\u63d0\u9192',
      resolvePrompt: '\u5904\u7406\u5907\u6ce8:',
      resolveDefault: '\u5df2\u5904\u7406',
      resolvedToast: '\u5df2\u6807\u8bb0\u5904\u7406',
      sentReply: '\u5df2\u53d1\u9001\u7ed9\u5ba2\u6237',
      testCustomer: '\u6d4b\u8bd5\u5ba2\u6237',
      sentTest: '\u6d4b\u8bd5\u5df2\u53d1\u9001',
      deleteConvConfirm: '\u786e\u5b9a\u4ece\u6570\u636e\u5e93\u6c38\u4e45\u5220\u9664\u6b64\u4f1a\u8bdd\uff1f\u6b64\u64cd\u4f5c\u65e0\u6cd5\u64a4\u9500\u3002',
      deletedConversation: '\u4f1a\u8bdd\u5df2\u6c38\u4e45\u5220\u9664',
      deleteMsgConfirm: '\u8f6f\u5220\u9664\u6b64\u6d88\u606f\uff1f',
      deletedMessage: '\u6d88\u606f\u5df2\u5220\u9664',
      reviewIssuePrompt: '\u8bb0\u5f55\u9700\u6539\u8fdb\u7684\u95ee\u9898:',
      reviewedAi: '\u5df2\u6807\u8bb0\u4e3a\u5f85\u6539\u8fdb'
      ,
      channelTitle: '\u6e20\u9053',
      sourceTitle: '\u4e3b\u9875 / \u7f51\u7ad9',
      loadMore: '\u52a0\u8f7d\u66f4\u591a',
      showingConversations: '\u5f53\u524d\u663e\u793a',
      customerDetails: '\u5ba2\u6237\u8be6\u60c5',
      close: '\u5173\u95ed',
      chooseConversation: '\u9009\u62e9\u4e00\u4e2a\u4f1a\u8bdd\u67e5\u770b\u6d88\u606f',
      testWebsiteTool: '\u6d4b\u8bd5\u7f51\u7ad9\u804a\u5929',
      moreActions: '\u66f4\u591a\u64cd\u4f5c'
    }
  };

  const pages = [
    ['dashboard', '/admin/', 'navDashboard', icons.dashboard],
    ['conversations', '/admin/conversations.html', 'navConversations', icons.conversations],
    ['alerts', '/admin/alerts.html', 'navAlerts', icons.alerts],
    ['improvements', '/admin/improvements.html', 'navImprovements', icons.improvements],
    ['knowledge', '/admin/knowledge.html', 'navKnowledge', icons.knowledge],
    ['logs', '/admin/logs.html', 'navLogs', icons.logs]
  ];

  const state = {
    theme: localStorage.getItem('kc-theme') || 'light',
    lang: localStorage.getItem('kc-admin-lang') || 'vi',
    user: null,
    page: '',
    title: '',
    subtitle: '',
    pollTimer: null,
    toastTimer: null
  };

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const t = key => (I18N[state.lang] && I18N[state.lang][key]) || I18N.vi[key] || key;

  function locale() {
    if (state.lang === 'zh') return 'zh-CN';
    if (state.lang === 'en') return 'en-US';
    return 'vi-VN';
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[char]));
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString(locale(), { hour12: false });
  }

  function shortDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString(locale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function toast(message) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, { credentials: 'same-origin', ...opts });
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      if (res.status === 401) showLogin(t('authAgain'));
      throw new Error(data?.error || res.statusText || 'request_failed');
    }
    return data;
  }

  async function checkAuth() {
    try {
      const me = await api('/auth/me');
      state.user = me.username || '';
      return true;
    } catch {
      return false;
    }
  }

  function setTheme(theme) {
    state.theme = theme === 'dark' ? 'dark' : 'light';
    localStorage.setItem('kc-theme', state.theme);
    document.documentElement.dataset.theme = state.theme;
    const btn = $('#themeBtn');
    if (btn) btn.textContent = state.theme === 'dark' ? t('themeLight') : t('themeDark');
  }

  function setLang(lang, reload = false) {
    state.lang = I18N[lang] ? lang : 'vi';
    localStorage.setItem('kc-admin-lang', state.lang);
    document.documentElement.lang = state.lang === 'zh' ? 'zh' : state.lang;
    $$('.lang-select').forEach(select => { select.value = state.lang; });
    setTheme(state.theme);
    if (reload) location.reload();
  }

  function langOptions() {
    return `
      <option value="vi" ${state.lang === 'vi' ? 'selected' : ''}>VI</option>
      <option value="en" ${state.lang === 'en' ? 'selected' : ''}>EN</option>
      <option value="zh" ${state.lang === 'zh' ? 'selected' : ''}>\u4e2d\u6587</option>
    `;
  }

  function bindLanguageSelectors() {
    $$('.lang-select').forEach(select => {
      select.value = state.lang;
      select.onchange = event => setLang(event.target.value, true);
    });
  }

  function icon(svgInner) {
    return `<span class="nav-icon"><svg viewBox="0 0 24 24" aria-hidden="true">${svgInner}</svg></span>`;
  }

  function renderLogin() {
    return `
      <div class="login-screen" id="loginScreen">
        <form class="login-card" id="loginForm">
          <div class="row space" style="align-items:flex-start">
            <div class="brand" style="color:var(--kc-text);padding:0">
              <span class="logo" style="background:var(--kc-primary)"><img src="/assets/kingcom-logo.png" alt="KingCom"></span>
              <div class="brand-title"><h1>KingCom</h1><span>Admin login</span></div>
            </div>
            <select class="lang-select compact" aria-label="Language">${langOptions()}</select>
          </div>
          <label for="loginUser">Username</label>
          <input id="loginUser" autocomplete="username" required>
          <label for="loginPass">Password</label>
          <input id="loginPass" type="password" autocomplete="current-password" required>
          <button class="btn" type="submit" style="width:100%;margin-top:16px">${t('login')}</button>
          <div class="login-error" id="loginError"></div>
        </form>
      </div>
    `;
  }

  function navHtml() {
    return pages.map(([key, href, labelKey, iconPath]) => `
      <a class="nav-btn ${state.page === key ? 'active' : ''}" href="${href}">
        ${icon(iconPath)}
        <span>${esc(t(labelKey))}</span>
      </a>
    `).join('');
  }

  function renderShell() {
    document.body.innerHTML = `
      ${renderLogin()}
      <div class="app-shell" id="appShell" hidden>
        <aside class="side-nav">
          <div class="brand">
            <span class="logo"><img src="/assets/kingcom-logo.png" alt="KingCom"></span>
            <div class="brand-title"><h1>KingCom</h1><span>AI Agent Admin</span></div>
          </div>
          <nav class="nav-menu">${navHtml()}</nav>
          <div class="nav-footer">
            <select class="lang-select" aria-label="Language">${langOptions()}</select>
            <button class="nav-btn" id="themeBtn" type="button"></button>
            <button class="nav-btn" id="logoutBtn" type="button">${t('logout')}</button>
          </div>
        </aside>
        <main class="main">
          <header class="topbar">
            <div class="page-title">
              <h2 id="pageTitle">${esc(state.title)}</h2>
              <p id="pageSubtitle">${esc(state.subtitle)}</p>
            </div>
            <div class="row">
              <button class="btn ghost" id="refreshPageBtn" type="button">${t('sync')}</button>
            </div>
          </header>
          <section class="content" id="content"></section>
        </main>
      </div>
      <div class="toast" id="toast"></div>
    `;
    setLang(state.lang);
    setTheme(state.theme);
    bindLanguageSelectors();
    $('#loginForm').onsubmit = login;
    $('#logoutBtn').onclick = logout;
    $('#themeBtn').onclick = () => setTheme(state.theme === 'dark' ? 'light' : 'dark');
  }

  function showLogin(message = '') {
    clearInterval(state.pollTimer);
    const login = $('#loginScreen');
    const shell = $('#appShell');
    if (login) login.hidden = false;
    if (shell) shell.hidden = true;
    const err = $('#loginError');
    if (err) err.textContent = message;
    setTimeout(() => $('#loginUser')?.focus(), 30);
  }

  function showShell() {
    $('#loginScreen').hidden = true;
    $('#appShell').hidden = false;
    $('#loginPass').value = '';
    $('#loginError').textContent = '';
  }

  async function login(event) {
    event.preventDefault();
    const username = $('#loginUser').value.trim();
    const password = $('#loginPass').value;
    const res = await fetch('/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    if (!res.ok) {
      showLogin(t('loginFailed'));
      return;
    }
    location.href = '/admin/';
  }

  async function logout() {
    await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
    showLogin('');
  }

  function setContent(html) {
    $('#content').innerHTML = html;
  }

  function pageTitle(title, subtitle) {
    state.title = title;
    state.subtitle = subtitle || '';
    const titleEl = $('#pageTitle');
    const subEl = $('#pageSubtitle');
    if (titleEl) titleEl.textContent = state.title;
    if (subEl) subEl.textContent = state.subtitle;
  }

  function resolveText(value, key) {
    return key ? t(key) : value;
  }

  function humanSource(row = {}) {
    return row.source_name || row.source_key || row.source_group || row.channel || '';
  }

  function statusBadge(text, cls = '') {
    return `<span class="badge ${cls}">${esc(text || '')}</span>`;
  }

  function empty(text) {
    return `<div class="empty">${esc(text || t('noData'))}</div>`;
  }

  async function bootPage(config) {
    state.page = config.page;
    state.title = resolveText(config.title, config.titleKey);
    state.subtitle = resolveText(config.subtitle || '', config.subtitleKey);
    renderShell();
    const ok = await checkAuth();
    if (!ok) {
      showLogin('');
      return;
    }
    showShell();

    async function refresh(silent = false) {
      try {
        if (config.load) await config.load();
        const title = resolveText(config.title, config.titleKey);
        const subtitle = resolveText(config.subtitle || '', config.subtitleKey);
        pageTitle(title, subtitle);
        setContent(config.render ? config.render() : '');
        if (config.bind) config.bind();
        $('#refreshPageBtn').onclick = () => refresh().then(() => toast(t('synced'))).catch(e => toast(e.message));
        if (!silent) toast(t('synced'));
      } catch (e) {
        setContent(`<div class="card"><div class="card-body">${esc(e.message)}</div></div>`);
        toast(`${t('loadError')}: ${e.message}`);
      }
    }

    await refresh(true);
    if (config.pollMs) {
      state.pollTimer = setInterval(() => refresh(true), config.pollMs);
    }
  }

  window.KC = {
    API,
    state,
    $,
    $$,
    esc,
    api,
    bootPage,
    setContent,
    toast,
    formatDate,
    shortDate,
    humanSource,
    statusBadge,
    empty,
    t
  };
})();
