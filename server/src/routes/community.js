var express = require('express');
var router = express.Router();
var db = require('../utils/db');
var auth = require('../middleware/auth');
var exp = require('../utils/exp');
var time = require('../utils/time');
var relaySync = require('../utils/relay-sync');
var constants = require('../utils/constants');

router.use(auth.requireAuth);

var VALID_POST_TYPES = ['forum', 'food', 'hot', 'poll', 'survey'];
var VALID_TARGET_TYPES = ['post', 'comment', 'user'];
var VALID_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '😡'];

function stripAdminFields(posts, reqUser) {
  var canViewAnonymous = false;
  if (reqUser && reqUser.is_admin === 1) {
    canViewAnonymous = true;
  } else if (reqUser && reqUser.role === 'officer') {
    try {
      var perms = JSON.parse(reqUser.officer_permissions || '[]');
      if (perms.indexOf('manage_community') !== -1) canViewAnonymous = true;
    } catch (e) {}
  }
  if (!canViewAnonymous) {
    for (var i = 0; i < posts.length; i++) {
      delete posts[i].admin_net_name;
      delete posts[i].admin_real_name;
    }
  }
  return posts;
}

function convertTimes(obj) {
  if (!obj) return obj;
  if (obj.created_at) obj.created_at = time.toISOString(obj.created_at);
  if (obj.updated_at) obj.updated_at = time.toISOString(obj.updated_at);
  if (obj.bookmarked_at) obj.bookmarked_at = time.toISOString(obj.bookmarked_at);
  return obj;
}

function convertTimesArray(arr) {
  for (var i = 0; i < arr.length; i++) {
    convertTimes(arr[i]);
  }
  return arr;
}

function isValidType(type, validTypes) {
  return validTypes.indexOf(type) !== -1;
}

function checkRateLimit(userId, action, maxCount, windowSeconds) {
  var now = new Date();
  var windowStart = new Date(now.getTime() - windowSeconds * 1000);
  var windowStr = windowStart.toISOString().replace('T', ' ').substring(0, 19);
  var allowedTables = { community_posts: 'community_posts', community_comments: 'community_comments' };
  var tableName = allowedTables[action.table];
  if (!tableName) return false;
  var countStmt = db.prepare('SELECT COUNT(*) as cnt FROM ' + tableName + ' WHERE user_id = ? AND created_at >= ?');
  var result = countStmt.get(userId, windowStr);
  return result.cnt < maxCount;
}

// ==================== 帖子 CRUD ====================

router.post('/posts', function(req, res) {
  var userId = req.user.user_id;
  var type = req.body.type || 'forum';
  var title = (req.body.title || '').trim();
  var content = (req.body.content || '').trim();
  var isAnonymous = req.body.is_anonymous ? 1 : 0;
  var visibleGroups = req.body.visible_groups || [];
  var hiddenGroups = req.body.hidden_groups || [];

  if (!Array.isArray(visibleGroups)) { visibleGroups = []; }
  if (!Array.isArray(hiddenGroups)) { hiddenGroups = []; }
  var visibleGroupsJson = JSON.stringify(visibleGroups);
  var hiddenGroupsJson = JSON.stringify(hiddenGroups);
  var extraJson;
  var tags = req.body.tags || [];
  if (!Array.isArray(tags)) { tags = []; }
  tags = tags.filter(function(t) { return typeof t === 'string' && t.trim().length > 0 && t.trim().length <= 20; }).slice(0, 5);
  var tagsJson = JSON.stringify(tags);

  if (!content && type !== 'poll' && type !== 'survey') {
    return res.status(400).json({ code: 400, message: '内容不能为空' });
  }
  if (!isValidType(type, VALID_POST_TYPES)) {
    return res.status(400).json({ code: 400, message: '无效的帖子类型' });
  }
  if (type === 'food' && !title.trim()) {
    return res.status(400).json({ code: 400, message: '菜名不能为空' });
  }
  if (type === 'hot' && !title.trim()) {
    return res.status(400).json({ code: 400, message: '标题不能为空' });
  }
  if ((type === 'poll' || type === 'survey') && !title.trim()) {
    return res.status(400).json({ code: 400, message: '标题不能为空' });
  }

  var extraData = req.body.extra || {};
  if (type === 'poll') {
    var pollOptions = extraData.poll_options;
    if (!Array.isArray(pollOptions) || pollOptions.length < 2) {
      return res.status(400).json({ code: 400, message: '投票至少需要2个选项' });
    }
    if (pollOptions.length > 10) {
      return res.status(400).json({ code: 400, message: '投票最多10个选项' });
    }
    extraData.poll_options = pollOptions.filter(function(o) { return typeof o === 'string' && o.trim().length > 0; }).slice(0, 10);
    if (extraData.poll_options.length < 2) {
      return res.status(400).json({ code: 400, message: '投票至少需要2个有效选项' });
    }
    extraData.max_choices = Math.min(Math.max(parseInt(extraData.max_choices) || 1, 1), extraData.poll_options.length);
    extraData.allow_multiple = !!extraData.allow_multiple;
    if (!content) content = title;
  }
  if (type === 'survey') {
    var questions = extraData.questions;
    if (!Array.isArray(questions) || questions.length < 1) {
      return res.status(400).json({ code: 400, message: '问卷至少需要1个问题' });
    }
    if (questions.length > 20) {
      return res.status(400).json({ code: 400, message: '问卷最多20个问题' });
    }
    extraData.questions = questions.slice(0, 20);
    if (!content) content = title;
  }
  extraJson = JSON.stringify(extraData);

  if (!checkRateLimit(userId, { table: 'community_posts' }, 20, 3600)) {
    return res.status(429).json({ code: 429, message: '发帖过于频繁，请稍后再试' });
  }

  var stmt = db.prepare(
    "INSERT INTO community_posts (user_id, type, title, content, anonymous, visible_groups, hidden_groups, extra_json, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  var result = stmt.run(userId, type, title, content, isAnonymous, visibleGroupsJson, hiddenGroupsJson, extraJson, tagsJson);

  relaySync.updateWatermark('community_posts', result.lastInsertRowid);

  var postStmt = db.prepare(
    'SELECT p.*, u.net_name, u.real_name FROM community_posts p LEFT JOIN users u ON p.user_id = u.user_id WHERE p.id = ?'
  );
  var post = postStmt.get(result.lastInsertRowid);
  post.is_anonymous = post.anonymous;
  convertTimes(post);

  try { exp.addExp(userId, 'create_post'); } catch (e) { console.error('[Community] Operation failed:', e.message); }

  constants.relayEvent('community_event', {
    action: 'create_post',
    post: {
      id: post.id,
      user_id: post.user_id,
      net_name: post.net_name,
      real_name: post.real_name,
      type: post.type,
      title: post.title,
      content: post.content,
      anonymous: post.anonymous,
      visible_groups: post.visible_groups || '[]',
      hidden_groups: post.hidden_groups || '[]',
      extra_json: post.extra_json || '{}',
      tags: post.tags || '[]',
      created_at: post.created_at
    }
  });

  res.json({ code: 200, message: 'ok', data: post });
});

router.post('/posts/:postId/vote', function(req, res) {
  var userId = req.user.user_id;
  var postId = parseInt(req.params.postId);
  var optionIndex = req.body.option_index;
  var optionIndices = req.body.option_indices;

  if (!postId) {
    return res.status(400).json({ code: 400, message: '无效的帖子ID' });
  }

  try {
    var post = db.prepare('SELECT id, type, extra_json FROM community_posts WHERE id = ?').get(postId);
    if (!post) {
      return res.status(404).json({ code: 404, message: '帖子不存在' });
    }
    if (post.type !== 'poll' && post.type !== 'survey') {
      return res.status(400).json({ code: 400, message: '该帖子不支持投票' });
    }

    var extra = {};
    try { extra = JSON.parse(post.extra_json || '{}'); } catch (e) {}

    var votes = extra.votes || {};
    if (votes[userId]) {
      return res.status(400).json({ code: 400, message: '你已经投过票了' });
    }

    if (post.type === 'poll') {
      var selectedIndices = [];
      if (extra.allow_multiple && Array.isArray(optionIndices)) {
        selectedIndices = optionIndices.filter(function(i) {
          return typeof i === 'number' && i >= 0 && i < (extra.poll_options || []).length;
        }).slice(0, extra.max_choices || 1);
      } else if (typeof optionIndex === 'number' && optionIndex >= 0 && optionIndex < (extra.poll_options || []).length) {
        selectedIndices = [optionIndex];
      }

      if (selectedIndices.length === 0) {
        return res.status(400).json({ code: 400, message: '请选择投票选项' });
      }

      votes[userId] = selectedIndices;
      extra.votes = votes;

      var totalVotes = Object.keys(votes).length;
      var optionCounts = {};
      for (var i = 0; i < (extra.poll_options || []).length; i++) {
        optionCounts[i] = 0;
      }
      for (var uid in votes) {
        var userChoices = votes[uid];
        for (var j = 0; j < userChoices.length; j++) {
          if (optionCounts[userChoices[j]] !== undefined) {
            optionCounts[userChoices[j]]++;
          }
        }
      }
      extra.total_votes = totalVotes;
      extra.option_counts = optionCounts;

      db.prepare('UPDATE community_posts SET extra_json = ? WHERE id = ?')
        .run(JSON.stringify(extra), postId);

      res.json({ code: 200, message: '投票成功', data: { votes: extra.votes, total_votes: extra.total_votes, option_counts: extra.option_counts, user_vote: selectedIndices } });
    } else {
      var answers = req.body.answers;
      if (!Array.isArray(answers) || answers.length === 0) {
        return res.status(400).json({ code: 400, message: '请回答问卷' });
      }

      votes[userId] = answers;
      extra.votes = votes;
      extra.total_votes = Object.keys(votes).length;

      db.prepare('UPDATE community_posts SET extra_json = ? WHERE id = ?')
        .run(JSON.stringify(extra), postId);

      res.json({ code: 200, message: '提交成功', data: { total_votes: extra.total_votes } });
    }
  } catch (e) {
    console.error('[Community] Vote error:', e.message);
    res.status(500).json({ code: 500, message: '投票失败' });
  }
});

router.get('/posts/:postId/results', function(req, res) {
  var userId = req.user.user_id;
  var postId = parseInt(req.params.postId);

  if (!postId) {
    return res.status(400).json({ code: 400, message: '无效的帖子ID' });
  }

  try {
    var post = db.prepare('SELECT id, type, extra_json FROM community_posts WHERE id = ?').get(postId);
    if (!post) {
      return res.status(404).json({ code: 404, message: '帖子不存在' });
    }
    if (post.type !== 'poll' && post.type !== 'survey') {
      return res.status(400).json({ code: 400, message: '该帖子不支持查看结果' });
    }

    var extra = {};
    try { extra = JSON.parse(post.extra_json || '{}'); } catch (e) {}

    var hasVoted = !!(extra.votes && extra.votes[userId]);

    var postRow = db.prepare('SELECT user_id FROM community_posts WHERE id = ?').get(postId);
    var isOwner = postRow && String(postRow.user_id) === String(userId);
    if (!hasVoted && !isOwner) {
      return res.status(403).json({ code: 403, message: '请先投票后再查看结果' });
    }

    if (post.type === 'poll') {
      var pollOptions = extra.poll_options || [];
      var optionCounts = extra.option_counts || {};
      var totalVotes = extra.total_votes || 0;
      var results = [];
      for (var i = 0; i < pollOptions.length; i++) {
        var count = optionCounts[i] || 0;
        results.push({
          index: i,
          text: pollOptions[i],
          count: count,
          percent: totalVotes > 0 ? Math.round(count / totalVotes * 100) : 0
        });
      }
      res.json({
        code: 200,
        data: {
          type: 'poll',
          has_voted: hasVoted,
          user_vote: hasVoted ? extra.votes[userId] : null,
          total_votes: totalVotes,
          allow_multiple: !!extra.allow_multiple,
          max_choices: extra.max_choices || 1,
          results: results
        }
      });
    } else {
      var questions = extra.questions || [];
      var votes = extra.votes || {};
      var totalSurveyVotes = extra.total_votes || 0;
      var questionResults = [];
      for (var qi = 0; qi < questions.length; qi++) {
        var q = questions[qi];
        var qResult = { question: q.question, type: q.type, options: q.options || [], answer_count: 0, option_counts: {}, text_answers_count: 0, text_answers: [] };
        for (var uid in votes) {
          var userAnswers = votes[uid];
          if (userAnswers && userAnswers[qi] !== undefined && userAnswers[qi] !== null && userAnswers[qi] !== '') {
            qResult.answer_count++;
            if (q.type === 'text') {
              qResult.text_answers_count++;
              var answerText = String(userAnswers[qi]);
              if (answerText.trim()) {
                var voterName = null;
                try { var voterRow = db.prepare('SELECT net_name FROM users WHERE user_id = ?').get(uid); if (voterRow) voterName = voterRow.net_name; } catch(e) {}
                qResult.text_answers.push({ user: voterName || '匿名', text: answerText });
              }
            } else {
              var userChoice = userAnswers[qi];
              if (Array.isArray(userChoice)) {
                for (var ci = 0; ci < userChoice.length; ci++) {
                  var optIdx = userChoice[ci];
                  qResult.option_counts[optIdx] = (qResult.option_counts[optIdx] || 0) + 1;
                }
              } else if (typeof userChoice === 'number') {
                qResult.option_counts[userChoice] = (qResult.option_counts[userChoice] || 0) + 1;
              }
            }
          }
        }
        questionResults.push(qResult);
      }
      res.json({
        code: 200,
        data: {
          type: 'survey',
          has_voted: hasVoted,
          total_votes: totalSurveyVotes,
          questions: questionResults
        }
      });
    }
  } catch (e) {
    console.error('[Community] Results error:', e.message);
    res.status(500).json({ code: 500, message: '获取结果失败' });
  }
});

router.get('/posts', function(req, res) {
  var userId = req.user.user_id;
  var isAdmin = req.user.is_admin;
  var canManageCommunity = false;
  if (!isAdmin && req.user.role === 'officer') {
    try {
      var perms = JSON.parse(req.user.officer_permissions || '[]');
      if (perms.indexOf('manage_community') !== -1) canManageCommunity = true;
    } catch (e) {}
  }
  var type = req.query.type || 'forum';
  var featured = req.query.featured;
  var page = Math.max(1, parseInt(req.query.page) || 1);
  var limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  var offset = (page - 1) * limit;

  if (!isValidType(type, VALID_POST_TYPES)) {
    type = 'forum';
  }

  var userStmt = db.prepare('SELECT gender FROM users WHERE user_id = ?');
  var user = userStmt.get(userId);
  var userGender = user ? user.gender : '';

  var types = [type];
  if (type === 'forum') {
    types = ['forum', 'poll', 'survey'];
  }
  var placeholders = types.map(function() { return '?'; }).join(',');

  var featuredClause = '';
  var featuredParams = [];
  if (featured === '1' || featured === 'true') {
    featuredClause = ' AND featured = 1';
  }

  var countStmt = db.prepare('SELECT COUNT(*) as total FROM community_posts WHERE type IN (' + placeholders + ')' + featuredClause);
  var countParams = types.concat(featuredParams);
  var totalResult = countStmt.get.apply(countStmt, countParams);
  var total = totalResult.total;

  var sort = req.query.sort || 'latest';
  var orderStr = 'ORDER BY p.created_at DESC';
  if (sort === 'hot') {
    orderStr = 'ORDER BY p.like_count DESC, p.created_at DESC';
  }

  var listStmt = db.prepare(
    'SELECT p.*, ' +
    'CASE WHEN p.anonymous = 1 THEN NULL ELSE u.net_name END as net_name, ' +
    'CASE WHEN p.anonymous = 1 THEN NULL ELSE u.real_name END as real_name, ' +
    'CASE WHEN p.anonymous = 1 THEN NULL ELSE u.gender END as poster_gender, ' +
    'u.net_name as admin_net_name, ' +
    'u.real_name as admin_real_name ' +
    'FROM community_posts p LEFT JOIN users u ON p.user_id = u.user_id ' +
    'WHERE p.type IN (' + placeholders + ')' + featuredClause + ' ' +
    orderStr + ' LIMIT ? OFFSET ?'
  );
  var queryParams = countParams.concat([limit, offset]);
  var posts = listStmt.all.apply(listStmt, queryParams);

  var likeStmt = db.prepare('SELECT target_id FROM community_likes WHERE user_id = ? AND target_type = \'post\'');
  var userLikes = likeStmt.all(userId);
  var likedSet = {};
  for (var i = 0; i < userLikes.length; i++) {
    likedSet[userLikes[i].target_id] = true;
  }

  var bookmarkStmt = db.prepare('SELECT post_id FROM community_bookmarks WHERE user_id = ?');
  var userBookmarks = bookmarkStmt.all(userId);
  var bookmarkSet = {};
  for (var b = 0; b < userBookmarks.length; b++) {
    bookmarkSet[userBookmarks[b].post_id] = true;
  }

  var filteredPosts = [];

  // Collect all unique group IDs for batch query
  var allGroupIds = {};
  for (var k = 0; k < posts.length; k++) {
    var vIds = [];
    var hIds = [];
    try { vIds = JSON.parse(posts[k].visible_groups || '[]'); } catch (e) { console.error('[Community] Operation failed:', e.message); }
    try { hIds = JSON.parse(posts[k].hidden_groups || '[]'); } catch (e) { console.error('[Community] Operation failed:', e.message); }
    for (var vi = 0; vi < vIds.length; vi++) { allGroupIds[vIds[vi]] = true; }
    for (var hi = 0; hi < hIds.length; hi++) { allGroupIds[hIds[hi]] = true; }
  }

  // Single batch query for all group names
  var groupNameMap = {};
  var uniqueGroupIds = Object.keys(allGroupIds);
  if (uniqueGroupIds.length > 0) {
    var batchPlaceholders = uniqueGroupIds.map(function() { return '?'; }).join(',');
    var batchStmt = db.prepare('SELECT id, name FROM community_groups WHERE id IN (' + batchPlaceholders + ')');
    var batchRows = batchStmt.all.apply(batchStmt, uniqueGroupIds);
    for (var bi = 0; bi < batchRows.length; bi++) {
      groupNameMap[batchRows[bi].id] = batchRows[bi].name;
    }
  }

  for (var j = 0; j < posts.length; j++) {
    var post = posts[j];
    post.liked = !!likedSet[post.id];
    post.is_anonymous = post.anonymous;
    post.bookmarked = !!bookmarkSet[post.id];
    try { post.tags = JSON.parse(post.tags || '[]'); } catch (e) { post.tags = []; }
    // 从 extra_json 解析 relayed_from 到顶层
    try {
      var postExtra = JSON.parse(post.extra_json || '{}');
      if (postExtra.relayed_from) {
        post.relayed_from = postExtra.relayed_from;
      }
    } catch (e) {}

    if (isAdmin || canManageCommunity) {
      filteredPosts.push(post);
      continue;
    }

    if (post.user_id === userId) {
      filteredPosts.push(post);
      continue;
    }

    var visible = [];
    var hidden = [];
    try { visible = JSON.parse(post.visible_groups || '[]'); } catch (e) { console.error('[Community] Operation failed:', e.message); }
    try { hidden = JSON.parse(post.hidden_groups || '[]'); } catch (e) { console.error('[Community] Operation failed:', e.message); }

    if (visible.length > 0) {
      var groupNames = visible.map(function(gid) { return groupNameMap[gid]; }).filter(function(n) { return n; });
      if (groupNames.indexOf(userGender) === -1 && groupNames.indexOf('全部') === -1) {
        continue;
      }
    }

    if (hidden.length > 0) {
      var hiddenNames = hidden.map(function(gid) { return groupNameMap[gid]; }).filter(function(n) { return n; });
      if (hiddenNames.indexOf(userGender) !== -1) {
        continue;
      }
    }

    filteredPosts.push(post);
  }

  convertTimesArray(filteredPosts);
  stripAdminFields(filteredPosts, req.user);

  res.json({ code: 200, message: 'ok', data: { posts: filteredPosts, total: filteredPosts.length, page: page } });
});

router.get('/posts/:id', function(req, res) {
  var userId = req.user.user_id;
  var postId = parseInt(req.params.id);
  if (isNaN(postId)) {
    return res.status(400).json({ code: 400, message: '无效的帖子ID' });
  }

  var stmt = db.prepare(
    'SELECT p.*, ' +
    'CASE WHEN p.anonymous = 1 THEN NULL ELSE u.net_name END as net_name, ' +
    'CASE WHEN p.anonymous = 1 THEN NULL ELSE u.real_name END as real_name, ' +
    'u.net_name as admin_net_name, ' +
    'u.real_name as admin_real_name ' +
    'FROM community_posts p LEFT JOIN users u ON p.user_id = u.user_id ' +
    'WHERE p.id = ?'
  );
  var post = stmt.get(postId);
  if (!post) {
    return res.status(404).json({ code: 404, message: '帖子不存在' });
  }

  var likeCheck = db.prepare('SELECT id FROM community_likes WHERE user_id = ? AND target_type = \'post\' AND target_id = ?');
  post.liked = !!likeCheck.get(userId, String(postId));
  post.is_anonymous = post.anonymous;
  try { post.tags = JSON.parse(post.tags || '[]'); } catch (e) { post.tags = []; }
  // 从 extra_json 解析 relayed_from 到顶层
  try {
    var detailExtra = JSON.parse(post.extra_json || '{}');
    if (detailExtra.relayed_from) {
      post.relayed_from = detailExtra.relayed_from;
    }
  } catch (e) {}

  var bookmarkCheck = db.prepare('SELECT id FROM community_bookmarks WHERE user_id = ? AND post_id = ?');
  post.bookmarked = !!bookmarkCheck.get(userId, postId);

  convertTimes(post);
  stripAdminFields([post], req.user);

  res.json({ code: 200, message: 'ok', data: post });
});

router.delete('/posts/:id', function(req, res) {
  var userId = req.user.user_id;
  var isAdmin = req.user.is_admin;
  var canManageCommunity = false;
  if (!isAdmin) {
    try {
      var dbUser = db.prepare('SELECT is_admin, role, officer_permissions FROM users WHERE user_id = ?').get(userId);
      if (dbUser && dbUser.is_admin === 1) isAdmin = 1;
      if (dbUser && dbUser.role === 'officer') {
        try {
          var perms = JSON.parse(dbUser.officer_permissions || '[]');
          if (perms.indexOf('manage_community') !== -1) canManageCommunity = true;
        } catch (e2) {}
      }
    } catch (e) { console.error('[Community] Operation failed:', e.message); }
  }
  var postId = parseInt(req.params.id);
  if (isNaN(postId)) {
    return res.status(400).json({ code: 400, message: '无效的帖子ID' });
  }

  var checkStmt = db.prepare('SELECT user_id FROM community_posts WHERE id = ?');
  var post = checkStmt.get(postId);
  if (!post) {
    return res.status(404).json({ code: 404, message: '帖子不存在' });
  }
  if (post.user_id !== userId && !isAdmin && !canManageCommunity) {
    return res.status(403).json({ code: 403, message: '无权删除此帖子' });
  }

  var commentIds = db.prepare('SELECT id FROM community_comments WHERE post_id = ?').all(postId).map(function(c) { return c.id; });
  if (commentIds.length > 0) {
    var placeholders = commentIds.map(function() { return '?'; }).join(',');
    db.prepare('DELETE FROM community_likes WHERE target_type = \'comment\' AND target_id IN (' + placeholders + ')').run(commentIds);
  }
  db.prepare('DELETE FROM community_likes WHERE target_type = \'post\' AND target_id = ?').run(String(postId));
  db.prepare('DELETE FROM community_comments WHERE post_id = ?').run(postId);
  db.prepare('DELETE FROM community_posts WHERE id = ?').run(postId);

  relaySync.recordTombstone('community_posts', postId);

  constants.relayEvent('community_event', {
    action: 'delete_post',
    post_id: postId
  });

  res.json({ code: 200, message: 'ok' });
});

// ==================== 评论 ====================

router.post('/posts/:id/comments', function(req, res) {
  var userId = req.user.user_id;
  var postId = parseInt(req.params.id);
  var content = (req.body.content || '').trim();
  var parentId = req.body.parent_id ? parseInt(req.body.parent_id) : null;

  if (isNaN(postId)) {
    return res.status(400).json({ code: 400, message: '无效的帖子ID' });
  }
  if (!content) {
    return res.status(400).json({ code: 400, message: '评论内容不能为空' });
  }

  if (!checkRateLimit(userId, { table: 'community_comments' }, 30, 3600)) {
    return res.status(429).json({ code: 429, message: '评论过于频繁，请稍后再试' });
  }

  var postCheck = db.prepare('SELECT id FROM community_posts WHERE id = ?');
  if (!postCheck.get(postId)) {
    return res.status(404).json({ code: 404, message: '帖子不存在' });
  }

  if (parentId) {
    var parentCheck = db.prepare('SELECT id FROM community_comments WHERE id = ? AND post_id = ?');
    if (!parentCheck.get(parentId, postId)) {
      return res.status(400).json({ code: 400, message: '回复的评论不存在' });
    }
  }

  var stmt = db.prepare('INSERT INTO community_comments (post_id, user_id, parent_id, content) VALUES (?, ?, ?, ?)');
  var result = stmt.run(postId, userId, parentId, content);

  relaySync.updateWatermark('community_comments', result.lastInsertRowid);

  db.prepare('UPDATE community_posts SET comment_count = comment_count + 1, updated_at = datetime(\'now\') WHERE id = ?').run(postId);

  var commentStmt = db.prepare('SELECT c.*, u.net_name, u.real_name FROM community_comments c LEFT JOIN users u ON c.user_id = u.user_id WHERE c.id = ?');
  var comment = commentStmt.get(result.lastInsertRowid);
  comment.like_count = 0;
  convertTimes(comment);

  try { exp.addExp(userId, 'add_comment'); } catch (e) { console.error('[Community] Operation failed:', e.message); }

  constants.relayEvent('community_event', {
    action: 'create_comment',
    comment: {
      id: comment.id,
      post_id: comment.post_id,
      user_id: comment.user_id,
      net_name: comment.net_name,
      real_name: comment.real_name,
      content: comment.content,
      parent_id: comment.parent_id,
      like_count: 0,
      created_at: comment.created_at
    }
  });

  res.json({ code: 200, message: 'ok', data: comment });
});

router.get('/posts/:id/comments', function(req, res) {
  var userId = req.user.user_id;
  var postId = parseInt(req.params.id);
  if (isNaN(postId)) {
    return res.status(400).json({ code: 400, message: '无效的帖子ID' });
  }

  var stmt = db.prepare('SELECT c.*, u.net_name, u.real_name FROM community_comments c LEFT JOIN users u ON c.user_id = u.user_id WHERE c.post_id = ? ORDER BY c.created_at ASC');
  var comments = stmt.all(postId);

  var commentLikeStmt = db.prepare('SELECT target_id FROM community_likes WHERE user_id = ? AND target_type = \'comment\'');
  var commentLikes = commentLikeStmt.all(userId);
  var commentLikedSet = {};
  for (var i = 0; i < commentLikes.length; i++) {
    commentLikedSet[commentLikes[i].target_id] = true;
  }

  for (var j = 0; j < comments.length; j++) {
    comments[j].liked = !!commentLikedSet[comments[j].id];
    if (comments[j].like_count === undefined || comments[j].like_count === null) {
      comments[j].like_count = 0;
    }
  }

  convertTimesArray(comments);

  res.json({ code: 200, message: 'ok', data: comments });
});

// ==================== 点赞 ====================

router.post('/likes', function(req, res) {
  var userId = req.user.user_id;
  var targetType = req.body.target_type;
  var targetId = req.body.target_id;

  if (!targetType || !isValidType(targetType, VALID_TARGET_TYPES)) {
    return res.status(400).json({ code: 400, message: '无效的点赞类型' });
  }

  if (targetType === 'user') {
    targetId = String(targetId);
    if (!targetId) {
      return res.status(400).json({ code: 400, message: '无效的目标ID' });
    }
  } else {
    targetId = parseInt(targetId);
    if (isNaN(targetId) || targetId <= 0) {
      return res.status(400).json({ code: 400, message: '无效的目标ID' });
    }
    targetId = String(targetId);
  }

  var todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  var todayStr = todayStart.toISOString().replace('T', ' ').substring(0, 19);

  var countStmt = db.prepare('SELECT COUNT(*) as cnt FROM community_likes WHERE user_id = ? AND created_at >= ?');
  var todayCount = countStmt.get(userId, todayStr);
  if (todayCount.cnt >= 30) {
    return res.status(429).json({ code: 429, message: '今日点赞次数已达上限（30次）' });
  }

  if (targetType === 'post') {
    var postStmt = db.prepare('SELECT user_id FROM community_posts WHERE id = ?');
    var post = postStmt.get(Number(targetId));
    if (!post) return res.status(404).json({ code: 404, message: '帖子不存在' });
    if (post.user_id === userId) return res.status(400).json({ code: 400, message: '不能给自己的帖子点赞' });
  } else if (targetType === 'comment') {
    var commentStmt = db.prepare('SELECT user_id FROM community_comments WHERE id = ?');
    var comment = commentStmt.get(Number(targetId));
    if (!comment) return res.status(404).json({ code: 404, message: '评论不存在' });
    if (comment.user_id === userId) return res.status(400).json({ code: 400, message: '不能给自己的评论点赞' });
  } else if (targetType === 'user') {
    if (String(targetId) === String(userId)) return res.status(400).json({ code: 400, message: '不能给自己点赞' });
    var userCheck = db.prepare('SELECT id FROM users WHERE user_id = ?');
    if (!userCheck.get(targetId)) return res.status(404).json({ code: 404, message: '用户不存在' });
  }

  var likeResult;
  try {
    likeResult = db.prepare('INSERT INTO community_likes (user_id, target_type, target_id) VALUES (?, ?, ?)').run(userId, targetType, targetId);
    if (likeResult.lastInsertRowid) {
      relaySync.updateWatermark('community_likes', likeResult.lastInsertRowid);
    }
  } catch (e) {
    if (e.message.indexOf('UNIQUE') > -1) {
      return res.status(400).json({ code: 400, message: '已经点过赞了' });
    }
    console.error('[Community] Like insert error:', e.message);
    return res.status(500).json({ code: 500, message: '操作失败' });
  }

  if (targetType === 'post') {
    db.prepare('UPDATE community_posts SET like_count = like_count + 1 WHERE id = ?').run(Number(targetId));
    var postOwner = db.prepare('SELECT user_id FROM community_posts WHERE id = ?').get(Number(targetId));
    if (postOwner && postOwner.user_id !== userId) {
      try { exp.addExp(postOwner.user_id, 'receive_like'); } catch (e) { console.error('[Community] Operation failed:', e.message); }
    }
  } else if (targetType === 'comment') {
    db.prepare('UPDATE community_comments SET like_count = like_count + 1 WHERE id = ?').run(Number(targetId));
    var commentOwner = db.prepare('SELECT user_id FROM community_comments WHERE id = ?').get(Number(targetId));
    if (commentOwner && commentOwner.user_id !== userId) {
      try { exp.addExp(commentOwner.user_id, 'receive_like'); } catch (e) { console.error('[Community] Operation failed:', e.message); }
    }
  }

  constants.relayEvent('community_event', {
    action: 'create_like',
    like: {
      user_id: userId,
      target_type: targetType,
      target_id: targetId
    }
  });

  res.json({ code: 200, message: 'ok' });
});

router.delete('/likes', function(req, res) {
  var userId = req.user.user_id;
  var targetType = req.body.target_type;
  var targetId = req.body.target_id;

  if (!targetType || !isValidType(targetType, VALID_TARGET_TYPES)) {
    return res.status(400).json({ code: 400, message: '无效的点赞类型' });
  }

  if (targetType === 'user') {
    targetId = String(targetId);
  } else {
    targetId = parseInt(targetId);
    if (isNaN(targetId)) {
      return res.status(400).json({ code: 400, message: '无效的目标ID' });
    }
    targetId = String(targetId);
  }

  var result = db.prepare('DELETE FROM community_likes WHERE user_id = ? AND target_type = ? AND target_id = ?').run(userId, targetType, targetId);

  if (result.changes > 0 && targetType === 'post') {
    db.prepare('UPDATE community_posts SET like_count = CASE WHEN like_count > 0 THEN like_count - 1 ELSE 0 END WHERE id = ?').run(Number(targetId));
  }
  if (result.changes > 0 && targetType === 'comment') {
    db.prepare('UPDATE community_comments SET like_count = CASE WHEN like_count > 0 THEN like_count - 1 ELSE 0 END WHERE id = ?').run(Number(targetId));
  }

  if (result.changes > 0) {
    constants.relayEvent('community_event', {
      action: 'delete_like',
      like: {
        user_id: userId,
        target_type: targetType,
        target_id: targetId
      }
    });
  }

  res.json({ code: 200, message: 'ok' });
});

// ==================== 排行榜 ====================

router.get('/ranking/food', function(req, res) {
  var userId = req.user.user_id;
  var limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
  var stmt = db.prepare(
    'SELECT p.*, CASE WHEN p.anonymous = 1 THEN NULL ELSE u.net_name END as net_name, u.net_name as admin_net_name, u.real_name as admin_real_name ' +
    'FROM community_posts p LEFT JOIN users u ON p.user_id = u.user_id ' +
    'WHERE p.type = \'food\' ORDER BY p.like_count DESC, p.created_at DESC LIMIT ?'
  );
  var posts = stmt.all(limit);

  var likeStmt = db.prepare('SELECT target_id FROM community_likes WHERE user_id = ? AND target_type = \'post\'');
  var userLikes = likeStmt.all(userId);
  var likedSet = {};
  for (var i = 0; i < userLikes.length; i++) {
    likedSet[userLikes[i].target_id] = true;
  }
  for (var j = 0; j < posts.length; j++) {
    posts[j].liked = !!likedSet[posts[j].id];
    posts[j].is_anonymous = posts[j].anonymous;
  }

  convertTimesArray(posts);
  stripAdminFields(posts, req.user);

  res.json({ code: 200, message: 'ok', data: posts });
});

router.post('/ranking/food', function(req, res) {
  var userId = req.user.user_id;
  var dishName = (req.body.dish_name || req.body.title || '').trim();
  var canteen = (req.body.canteen || '').trim();
  var windowName = (req.body.window || '').trim();
  var reason = (req.body.reason || req.body.content || '').trim();

  if (!dishName) {
    return res.status(400).json({ code: 400, message: '菜名不能为空' });
  }
  if (dishName.length > 50) {
    return res.status(400).json({ code: 400, message: '菜名不能超过50字' });
  }
  if (!canteen) {
    return res.status(400).json({ code: 400, message: '请选择食堂' });
  }
  if (reason.length > 500) {
    return res.status(400).json({ code: 400, message: '推荐理由不能超过500字' });
  }

  if (!checkRateLimit(userId, { table: 'community_posts' }, 20, 3600)) {
    return res.status(429).json({ code: 429, message: '操作过于频繁，请稍后再试' });
  }

  var extra = JSON.stringify({ canteen: canteen, window: windowName });
  var stmt = db.prepare(
    "INSERT INTO community_posts (user_id, type, title, content, visible_groups, hidden_groups, extra_json) VALUES (?, 'food', ?, ?, '[]', '[]', ?)"
  );
  var result = stmt.run(userId, dishName, reason, extra);

  relaySync.updateWatermark('community_posts', result.lastInsertRowid);

  var postStmt = db.prepare(
    'SELECT p.*, u.net_name, u.real_name FROM community_posts p LEFT JOIN users u ON p.user_id = u.user_id WHERE p.id = ?'
  );
  var post = postStmt.get(result.lastInsertRowid);
  post.is_anonymous = post.anonymous;
  convertTimes(post);

  constants.relayEvent('community_event', {
    action: 'create_post',
    post: {
      id: post.id,
      user_id: post.user_id,
      net_name: post.net_name,
      real_name: post.real_name,
      type: post.type,
      title: post.title,
      content: post.content,
      anonymous: post.anonymous,
      visible_groups: '[]',
      hidden_groups: '[]',
      extra_json: post.extra_json || '{}',
      tags: post.tags || '[]',
      created_at: post.created_at
    }
  });

  res.json({ code: 200, message: 'ok', data: post });
});

router.get('/ranking/hot', function(req, res) {
  var userId = req.user.user_id;
  var limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
  var stmt = db.prepare(
    'SELECT p.*, CASE WHEN p.anonymous = 1 THEN NULL ELSE u.net_name END as net_name, u.net_name as admin_net_name, u.real_name as admin_real_name ' +
    'FROM community_posts p LEFT JOIN users u ON p.user_id = u.user_id ' +
    'WHERE p.type = \'hot\' ORDER BY p.like_count DESC, p.created_at DESC LIMIT ?'
  );
  var posts = stmt.all(limit);

  var likeStmt = db.prepare('SELECT target_id FROM community_likes WHERE user_id = ? AND target_type = \'post\'');
  var userLikes = likeStmt.all(userId);
  var likedSet = {};
  for (var i = 0; i < userLikes.length; i++) {
    likedSet[userLikes[i].target_id] = true;
  }
  for (var j = 0; j < posts.length; j++) {
    posts[j].liked = !!likedSet[posts[j].id];
    posts[j].is_anonymous = posts[j].anonymous;
  }

  convertTimesArray(posts);
  stripAdminFields(posts, req.user);

  res.json({ code: 200, message: 'ok', data: posts });
});

router.post('/ranking/hot', function(req, res) {
  var userId = req.user.user_id;
  var title = (req.body.title || '').trim();
  var detail = (req.body.detail || req.body.content || '').trim();
  var location = (req.body.location || '').trim();

  if (!title) {
    return res.status(400).json({ code: 400, message: '标题不能为空' });
  }
  if (title.length > 100) {
    return res.status(400).json({ code: 400, message: '标题不能超过100字' });
  }
  if (!detail) {
    return res.status(400).json({ code: 400, message: '详情不能为空' });
  }

  if (!checkRateLimit(userId, { table: 'community_posts' }, 20, 3600)) {
    return res.status(429).json({ code: 429, message: '操作过于频繁，请稍后再试' });
  }

  var extra = JSON.stringify({ location: location });
  var stmt = db.prepare(
    "INSERT INTO community_posts (user_id, type, title, content, visible_groups, hidden_groups, extra_json) VALUES (?, 'hot', ?, ?, '[]', '[]', ?)"
  );
  var result = stmt.run(userId, title, detail, extra);

  relaySync.updateWatermark('community_posts', result.lastInsertRowid);

  var postStmt = db.prepare(
    'SELECT p.*, u.net_name, u.real_name FROM community_posts p LEFT JOIN users u ON p.user_id = u.user_id WHERE p.id = ?'
  );
  var post = postStmt.get(result.lastInsertRowid);
  post.is_anonymous = post.anonymous;
  convertTimes(post);

  constants.relayEvent('community_event', {
    action: 'create_post',
    post: {
      id: post.id,
      user_id: post.user_id,
      net_name: post.net_name,
      real_name: post.real_name,
      type: post.type,
      title: post.title,
      content: post.content,
      anonymous: post.anonymous,
      visible_groups: '[]',
      hidden_groups: '[]',
      extra_json: post.extra_json || '{}',
      tags: post.tags || '[]',
      created_at: post.created_at
    }
  });

  res.json({ code: 200, message: 'ok', data: post });
});

// ==================== 个人中心 ====================

router.get('/profile', function(req, res) {
  var userId = req.user.user_id;
  var stmt = db.prepare('SELECT id, user_id, net_name, real_name, gender, wechat, qq, phone, address, signature, privacy_settings, info_json FROM users WHERE user_id = ?');
  var user = stmt.get(userId);
  if (!user) {
    return res.status(404).json({ code: 404, message: '用户不存在' });
  }
  try { user.privacy_settings = JSON.parse(user.privacy_settings || '{}'); } catch (e) { user.privacy_settings = {}; }
  try { var info = JSON.parse(user.info_json || '{}'); user.birthday = info.birthday || ''; } catch (e) { user.birthday = ''; }
  delete user.info_json;
  res.json({ code: 200, message: 'ok', data: user });
});

router.put('/profile', function(req, res) {
  var userId = req.user.user_id;
  var fields = [];
  var values = [];
  var allowedFields = ['wechat', 'qq', 'phone', 'address', 'signature'];

  for (var i = 0; i < allowedFields.length; i++) {
    var field = allowedFields[i];
    if (req.body[field] !== undefined) {
      fields.push(field + ' = ?');
      values.push(String(req.body[field]).substring(0, 200));
    }
  }

  // 处理生日字段（存储在 info_json 中）
  if (req.body.birthday !== undefined) {
    var currentInfo = db.prepare('SELECT info_json FROM users WHERE user_id = ?').get(userId);
    var infoObj = {};
    try { infoObj = JSON.parse(currentInfo.info_json || '{}'); } catch (e) { console.error('[Community] Operation failed:', e.message); }
    infoObj.birthday = req.body.birthday;
    fields.push('info_json = ?');
    values.push(JSON.stringify(infoObj));
  }

  if (req.body.privacy_settings) {
    try {
      var ps = typeof req.body.privacy_settings === 'string' ? JSON.parse(req.body.privacy_settings) : req.body.privacy_settings;
      var sanitizedPs = {};
      var allowedPsKeys = ['wechat', 'qq', 'phone', 'address', 'signature', 'birthday', 'hide_real_name'];
      for (var k = 0; k < allowedPsKeys.length; k++) {
        if (ps[allowedPsKeys[k]] !== undefined) {
          sanitizedPs[allowedPsKeys[k]] = !!ps[allowedPsKeys[k]];
        }
      }
      fields.push('privacy_settings = ?');
      values.push(JSON.stringify(sanitizedPs));
    } catch (e) { console.error('[Community] Operation failed:', e.message); }
  }

  if (fields.length === 0) {
    return res.status(400).json({ code: 400, message: '没有需要更新的字段' });
  }

  values.push(userId);
  db.prepare('UPDATE users SET ' + fields.join(', ') + ' WHERE user_id = ?').run(values);

  db.prepare('UPDATE users SET updated_at = datetime(\'now\') WHERE user_id = ?').run(userId);

  try {
    var updatedUser = db.prepare('SELECT net_name, real_name, gender, info_json, wechat, qq, phone, address, signature, privacy_settings FROM users WHERE user_id = ?').get(userId);
    if (updatedUser) {
      constants.relayEvent('user_profile_updated', {
        user_id: userId,
        net_name: updatedUser.net_name,
        real_name: updatedUser.real_name || '',
        gender: updatedUser.gender || '',
        info_json: updatedUser.info_json || '{}',
        wechat: updatedUser.wechat || '',
        qq: updatedUser.qq || '',
        phone: updatedUser.phone || '',
        address: updatedUser.address || '',
        signature: updatedUser.signature || '',
        privacy_settings: updatedUser.privacy_settings || '{}'
      });
    }
  } catch (e) { console.error('[Community] Operation failed:', e.message); }

  res.json({ code: 200, message: 'ok' });
});

router.get('/profile/:userId', function(req, res) {
  var currentUserId = req.user.user_id;
  var targetUserId = req.params.userId;
  var isSelf = String(currentUserId) === String(targetUserId);

  var stmt = db.prepare('SELECT id, user_id, net_name, real_name, gender, wechat, qq, phone, address, signature, privacy_settings, info_json FROM users WHERE user_id = ?');
  var user = stmt.get(targetUserId);
  if (!user) {
    return res.status(404).json({ code: 404, message: '用户不存在' });
  }

  // 提取生日
  var birthday = '';
  try { var info = JSON.parse(user.info_json || '{}'); birthday = info.birthday || ''; } catch (e) { console.error('[Community] Operation failed:', e.message); }
  delete user.info_json;

  var privacySettings = {};
  try { privacySettings = JSON.parse(user.privacy_settings || '{}'); } catch (e) { console.error('[Community] Operation failed:', e.message); }

  var result = {
    id: user.id,
    net_name: user.net_name,
    gender: user.gender,
    signature: user.signature
  };

  // 真实姓名：根据隐私设置决定是否显示（hide_real_name=true 则隐藏）
  if (isSelf) {
    result.real_name = user.real_name;
  } else {
    if (!privacySettings.hide_real_name) {
      result.real_name = user.real_name;
    }
  }

  // 生日：根据隐私设置决定是否显示
  if (isSelf) {
    result.birthday = birthday;
  } else {
    if (!privacySettings.birthday) {
      result.birthday = birthday;
    }
  }

  if (isSelf) {
    result.wechat = user.wechat;
    result.qq = user.qq;
    result.phone = user.phone;
    result.address = user.address;
  } else {
    var privateFields = ['wechat', 'qq', 'phone', 'address'];
    for (var i = 0; i < privateFields.length; i++) {
      var field = privateFields[i];
      if (!privacySettings[field]) {
        result[field] = user[field] || '';
      }
    }
  }

  var likeCountStmt = db.prepare('SELECT COUNT(*) as cnt FROM community_likes WHERE target_type = \'user\' AND target_id = ?');
  result.like_count = likeCountStmt.get(String(targetUserId)).cnt;

  var likedByMe = db.prepare('SELECT id FROM community_likes WHERE user_id = ? AND target_type = \'user\' AND target_id = ?');
  result.liked_by_me = !!likedByMe.get(currentUserId, String(targetUserId));

  res.json({ code: 200, message: 'ok', data: result });
});

// ==================== 分组 ====================

router.get('/groups', function(req, res) {
  var stmt = db.prepare('SELECT * FROM community_groups ORDER BY id ASC');
  var groups = stmt.all();
  res.json({ code: 200, message: 'ok', data: groups });
});

router.post('/groups', function(req, res) {
  var name = (req.body.name || '').trim();
  if (!name) {
    return res.status(400).json({ code: 400, message: '分组名称不能为空' });
  }
  if (name.length > 20) {
    return res.status(400).json({ code: 400, message: '分组名称不能超过20字' });
  }

  try {
    var stmt = db.prepare('INSERT INTO community_groups (name, creator_id) VALUES (?, ?)');
    var result = stmt.run(name, req.user.user_id);
    var group = db.prepare('SELECT * FROM community_groups WHERE id = ?').get(result.lastInsertRowid);
    constants.relayEvent('community_group_created', {
      id: group.id,
      name: group.name,
      creator_id: group.creator_id,
      created_at: group.created_at
    });
    res.json({ code: 200, message: 'ok', data: group });
  } catch (e) {
    if (e.message.indexOf('UNIQUE') > -1) {
      return res.status(400).json({ code: 400, message: '分组名称已存在' });
    }
    console.error('[Community] Group insert error:', e.message);
    return res.status(500).json({ code: 500, message: '创建分组失败' });
  }
});

// ==================== 我的帖子 ====================

router.get('/my/posts', function(req, res) {
  var userId = req.user.user_id;
  var type = req.query.type || '';
  var page = Math.max(1, parseInt(req.query.page) || 1);
  var limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  var offset = (page - 1) * limit;

  var whereStr = 'WHERE p.user_id = ?';
  var params = [userId];

  if (type && isValidType(type, VALID_POST_TYPES)) {
    whereStr += ' AND p.type = ?';
    params.push(type);
  }

  var countStmt = db.prepare('SELECT COUNT(*) as total FROM community_posts p ' + whereStr);
  var total = countStmt.get.apply(countStmt, params).total;

  var listStmt = db.prepare(
    'SELECT p.*, u.net_name FROM community_posts p LEFT JOIN users u ON p.user_id = u.user_id ' +
    whereStr + ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?'
  );
  var queryParams = params.concat([limit, offset]);
  var posts = listStmt.all.apply(listStmt, queryParams);

  for (var i = 0; i < posts.length; i++) {
    posts[i].is_anonymous = posts[i].anonymous;
  }

  convertTimesArray(posts);
  stripAdminFields(posts, req.user);

  res.json({ code: 200, message: 'ok', data: { posts: posts, total: total, page: page } });
});

// ==================== 用户统计 ====================

router.get('/user-stats/:userId', function(req, res) {
  var targetUserId = req.params.userId;
  var postCount = db.prepare('SELECT COUNT(*) as cnt FROM community_posts WHERE user_id = ?').get(targetUserId).cnt;
  var likeReceivedCount = db.prepare(
    "SELECT COUNT(*) as cnt FROM community_likes WHERE target_type = 'user' AND target_id = ?"
  ).get(String(targetUserId)).cnt;
  var postLikeCount = db.prepare(
    "SELECT IFNULL(SUM(like_count), 0) as cnt FROM community_posts WHERE user_id = ?"
  ).get(targetUserId).cnt;
  var totalLikesReceived = likeReceivedCount + postLikeCount;
  var commentCount = db.prepare('SELECT COUNT(*) as cnt FROM community_comments WHERE user_id = ?').get(targetUserId).cnt;
  res.json({
    code: 200, message: 'ok',
    data: {
      post_count: postCount,
      like_count: totalLikesReceived,
      comment_count: commentCount
    }
  });
});

// ==================== 帖子搜索 ====================

router.get('/search', function(req, res) {
  var userId = req.user.user_id;
  var keyword = (req.query.q || '').trim();
  var type = req.query.type || '';
  var page = Math.max(1, parseInt(req.query.page) || 1);
  var limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  var offset = (page - 1) * limit;

  if (!keyword) {
    return res.json({ code: 200, message: 'ok', data: { posts: [], total: 0, page: page } });
  }
  if (keyword.length > 50) {
    return res.status(400).json({ code: 400, message: '搜索关键词不能超过50字' });
  }

  var whereStr = "WHERE (p.content LIKE ? OR p.title LIKE ?)";
  var escapedKeyword = keyword.replace(/[%_\\]/g, '\\$&');
  var searchPattern = '%' + escapedKeyword + '%';
  var params = [searchPattern, searchPattern];

  if (type && isValidType(type, VALID_POST_TYPES)) {
    whereStr += ' AND p.type = ?';
    params.push(type);
  }

  var countStmt = db.prepare('SELECT COUNT(*) as total FROM community_posts p ' + whereStr);
  var total = countStmt.get.apply(countStmt, params).total;

  var listStmt = db.prepare(
    'SELECT p.*, ' +
    'CASE WHEN p.anonymous = 1 THEN NULL ELSE u.net_name END as net_name, ' +
    'CASE WHEN p.anonymous = 1 THEN NULL ELSE u.real_name END as real_name, ' +
    'u.net_name as admin_net_name, ' +
    'u.real_name as admin_real_name ' +
    'FROM community_posts p LEFT JOIN users u ON p.user_id = u.user_id ' +
    whereStr + ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?'
  );
  var queryParams = params.concat([limit, offset]);
  var posts = listStmt.all.apply(listStmt, queryParams);

  var likeStmt = db.prepare('SELECT target_id FROM community_likes WHERE user_id = ? AND target_type = \'post\'');
  var userLikes = likeStmt.all(userId);
  var likedSet = {};
  for (var i = 0; i < userLikes.length; i++) {
    likedSet[userLikes[i].target_id] = true;
  }

  var bookmarkStmt = db.prepare('SELECT post_id FROM community_bookmarks WHERE user_id = ?');
  var userBookmarks = bookmarkStmt.all(userId);
  var bookmarkSet = {};
  for (var b = 0; b < userBookmarks.length; b++) {
    bookmarkSet[userBookmarks[b].post_id] = true;
  }

  for (var j = 0; j < posts.length; j++) {
    posts[j].liked = !!likedSet[posts[j].id];
    posts[j].is_anonymous = posts[j].anonymous;
    posts[j].bookmarked = !!bookmarkSet[posts[j].id];
    try { posts[j].tags = JSON.parse(posts[j].tags || '[]'); } catch (e) { posts[j].tags = []; }
  }

  convertTimesArray(posts);
  stripAdminFields(posts, req.user);

  res.json({ code: 200, message: 'ok', data: { posts: posts, total: total, page: page } });
});

// ==================== 收藏 ====================

router.post('/bookmarks/:postId', function(req, res) {
  var userId = req.user.user_id;
  var postId = parseInt(req.params.postId);
  if (isNaN(postId)) {
    return res.status(400).json({ code: 400, message: '无效的帖子ID' });
  }
  var postCheck = db.prepare('SELECT id FROM community_posts WHERE id = ?');
  if (!postCheck.get(postId)) {
    return res.status(404).json({ code: 404, message: '帖子不存在' });
  }
  try {
    var bookmarkResult = db.prepare('INSERT INTO community_bookmarks (user_id, post_id) VALUES (?, ?)').run(userId, postId);
    relaySync.updateWatermark('community_bookmarks', bookmarkResult.lastInsertRowid);
  } catch (e) {
    if (e.message.indexOf('UNIQUE') > -1) {
      return res.status(400).json({ code: 400, message: '已收藏' });
    }
    console.error('[Community] Bookmark insert error:', e.message);
    return res.status(500).json({ code: 500, message: '收藏失败' });
  }

  constants.relayEvent('bookmark_updated', {
    action: 'add',
    user_id: userId,
    post_id: postId,
    created_at: new Date().toISOString()
  });

  res.json({ code: 200, message: 'ok' });
});

router.delete('/bookmarks/:postId', function(req, res) {
  var userId = req.user.user_id;
  var postId = parseInt(req.params.postId);
  if (isNaN(postId)) {
    return res.status(400).json({ code: 400, message: '无效的帖子ID' });
  }
  db.prepare('DELETE FROM community_bookmarks WHERE user_id = ? AND post_id = ?').run(userId, postId);

  constants.relayEvent('bookmark_updated', {
    action: 'remove',
    user_id: userId,
    post_id: postId
  });

  res.json({ code: 200, message: 'ok' });
});

router.get('/bookmarks', function(req, res) {
  var userId = req.user.user_id;
  var page = Math.max(1, parseInt(req.query.page) || 1);
  var limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  var offset = (page - 1) * limit;

  var countStmt = db.prepare('SELECT COUNT(*) as total FROM community_bookmarks WHERE user_id = ?');
  var total = countStmt.get(userId).total;

  var stmt = db.prepare(
    'SELECT p.*, ' +
    'CASE WHEN p.anonymous = 1 THEN NULL ELSE u.net_name END as net_name, ' +
    'CASE WHEN p.anonymous = 1 THEN NULL ELSE u.real_name END as real_name, ' +
    'u.net_name as admin_net_name, ' +
    'u.real_name as admin_real_name, ' +
    'b.created_at as bookmarked_at ' +
    'FROM community_bookmarks b ' +
    'JOIN community_posts p ON b.post_id = p.id ' +
    'LEFT JOIN users u ON p.user_id = u.user_id ' +
    'WHERE b.user_id = ? ORDER BY b.created_at DESC LIMIT ? OFFSET ?'
  );
  var posts = stmt.all(userId, limit, offset);

  for (var i = 0; i < posts.length; i++) {
    posts[i].is_anonymous = posts[i].anonymous;
    posts[i].bookmarked = true;
    try { posts[i].tags = JSON.parse(posts[i].tags || '[]'); } catch (e) { posts[i].tags = []; }
  }

  convertTimesArray(posts);
  stripAdminFields(posts, req.user);

  res.json({ code: 200, message: 'ok', data: { posts: posts, total: total, page: page } });
});

// ==================== 分享计数 ====================

router.post('/posts/:id/share', function(req, res) {
  var postId = parseInt(req.params.id);
  if (isNaN(postId)) {
    return res.status(400).json({ code: 400, message: '无效的帖子ID' });
  }
  var postCheck = db.prepare('SELECT id FROM community_posts WHERE id = ?');
  if (!postCheck.get(postId)) {
    return res.status(404).json({ code: 404, message: '帖子不存在' });
  }
  db.prepare('UPDATE community_posts SET share_count = share_count + 1 WHERE id = ?').run(postId);
  constants.relayEvent('community_event', {
    action: 'share_post',
    post_id: postId
  });
  try { exp.addExp(req.user.user_id, 'share_post'); } catch (e) { console.error('[Community] Operation failed:', e.message); }
  res.json({ code: 200, message: 'ok' });
});

// ==================== 消息表情回应 ====================

router.post('/reactions', function(req, res) {
  var userId = req.user.user_id;
  var messageId = parseInt(req.body.message_id);
  var messageType = req.body.message_type || 'public';
  var emoji = req.body.emoji || '';

  if (isNaN(messageId) || !emoji) {
    return res.status(400).json({ code: 400, message: '参数无效' });
  }
  if (VALID_REACTIONS.indexOf(emoji) === -1) {
    return res.status(400).json({ code: 400, message: '不支持的表情' });
  }
  var validMsgTypes = ['public', 'group', 'private'];
  if (validMsgTypes.indexOf(messageType) === -1) {
    return res.status(400).json({ code: 400, message: '无效的消息类型' });
  }

  try {
    var reactionResult = db.prepare('INSERT INTO message_reactions (message_id, message_type, user_id, emoji) VALUES (?, ?, ?, ?)').run(messageId, messageType, userId, emoji);
    relaySync.updateWatermark('message_reactions', reactionResult.lastInsertRowid);
  } catch (e) {
    if (e.message.indexOf('UNIQUE') > -1) {
      return res.status(400).json({ code: 400, message: '已回应过' });
    }
    console.error('[Community] Reaction insert error:', e.message);
    return res.status(500).json({ code: 500, message: '操作失败' });
  }

  constants.relayEvent('message_reaction_added', {
    message_id: messageId,
    message_type: messageType,
    user_id: userId,
    emoji: emoji,
    created_at: new Date().toISOString()
  });

  res.json({ code: 200, message: 'ok' });
});

router.delete('/reactions', function(req, res) {
  var userId = req.user.user_id;
  var messageId = parseInt(req.body.message_id);
  var messageType = req.body.message_type || 'public';
  var emoji = req.body.emoji || '';

  if (isNaN(messageId) || !emoji) {
    return res.status(400).json({ code: 400, message: '参数无效' });
  }

  db.prepare('DELETE FROM message_reactions WHERE message_id = ? AND message_type = ? AND user_id = ? AND emoji = ?').run(messageId, messageType, userId, emoji);

  constants.relayEvent('message_reaction_removed', {
    message_id: messageId,
    message_type: messageType,
    user_id: userId,
    emoji: emoji
  });

  res.json({ code: 200, message: 'ok' });
});

router.get('/reactions/:messageId', function(req, res) {
  var messageId = parseInt(req.params.messageId);
  var messageType = req.query.type || 'public';
  if (isNaN(messageId)) {
    return res.status(400).json({ code: 400, message: '参数无效' });
  }

  var stmt = db.prepare('SELECT emoji, COUNT(*) as count FROM message_reactions WHERE message_id = ? AND message_type = ? GROUP BY emoji');
  var reactions = stmt.all(messageId, messageType);

  var userId = req.user.user_id;
  var myReactions = db.prepare('SELECT emoji FROM message_reactions WHERE message_id = ? AND message_type = ? AND user_id = ?').all(messageId, messageType, userId);
  var myEmojiSet = {};
  for (var i = 0; i < myReactions.length; i++) {
    myEmojiSet[myReactions[i].emoji] = true;
  }

  res.json({ code: 200, message: 'ok', data: { reactions: reactions, my_reactions: myEmojiSet } });
});

// ==================== 精选帖子 ====================

router.patch('/posts/:id/featured', function(req, res) {
  var postId = parseInt(req.params.id);
  var featured = req.body.featured ? 1 : 0;
  if (isNaN(postId)) return res.status(400).json({ code: 400, message: '无效的帖子ID' });
  var canFeature = false;
  if (req.user.is_admin === 1) {
    canFeature = true;
  } else if (req.user.role === 'officer') {
    try {
      var perms = JSON.parse(req.user.officer_permissions || '[]');
      if (perms.indexOf('manage_community') !== -1) canFeature = true;
    } catch (e) {}
  }
  if (!canFeature) return res.status(403).json({ code: 403, message: '无权限精选帖子' });
  var post = db.prepare('SELECT id FROM community_posts WHERE id = ?').get(postId);
  if (!post) return res.status(404).json({ code: 404, message: '帖子不存在' });
  db.prepare('UPDATE community_posts SET featured = ? WHERE id = ?').run(featured, postId);
  res.json({ code: 200, message: featured ? '已精选' : '已取消精选' });
});

// ==================== 删除评论 ====================

router.delete('/comments/:commentId', function(req, res) {
  var commentId = parseInt(req.params.commentId);
  if (isNaN(commentId)) return res.status(400).json({ code: 400, message: '无效的评论ID' });
  var comment = db.prepare('SELECT * FROM community_comments WHERE id = ?').get(commentId);
  if (!comment) return res.status(404).json({ code: 404, message: '评论不存在' });
  var canDelete = false;
  if (String(comment.user_id) === String(req.user.user_id)) {
    canDelete = true;
  } else if (req.user.is_admin === 1) {
    canDelete = true;
  } else if (req.user.role === 'officer') {
    try {
      var perms = JSON.parse(req.user.officer_permissions || '[]');
      if (perms.indexOf('manage_community') !== -1) canDelete = true;
    } catch (e) {}
  }
  if (!canDelete) return res.status(403).json({ code: 403, message: '无权限删除此评论' });
  db.prepare('DELETE FROM community_comments WHERE id = ?').run(commentId);
  db.prepare('DELETE FROM community_comments WHERE parent_id = ?').run(commentId);
  db.prepare('UPDATE community_posts SET comment_count = (SELECT COUNT(*) FROM community_comments WHERE post_id = ?) WHERE id = ?').run(comment.post_id, comment.post_id);
  relaySync.recordTombstone('community_comments', commentId);
  res.json({ code: 200, message: '评论已删除' });
});

module.exports = router;
