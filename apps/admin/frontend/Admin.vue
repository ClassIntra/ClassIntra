<template>
  <div class="admin-page">
    <AppNavBar title="系统管理" />
    <!-- Tab Navigation -->
    <div class="admin-tabs">
      <button
        v-for="tab in visibleTabs"
        :key="tab.key"
        class="admin-tab"
        :class="{ active: activeTab === tab.key }"
        @click="switchTab(tab.key)"
      >{{ tab.label }}</button>
    </div>
    <!-- Content Area with Transition -->
    <div class="admin-content scrollbar-thin">
      <transition name="tab-fade" mode="out-in">

        <!-- ========== 用户管理 ========== -->
        <div v-if="activeTab === 'users'" key="users" class="admin-section">
          <div class="section-toolbar">
            <div class="toolbar-left">
              <input
                v-model="userSearch"
                class="search-input"
                placeholder="搜索用户..."
                @input="onUserSearchInput"
              />
              <select v-model="userRoleFilter" class="filter-select" @change="applyUserFilters">
                <option value="">全部角色</option>
                <option value="admin">管理员</option>
                <option value="officer">班干</option>
                <option value="user">普通用户</option>
              </select>
              <select v-model="userStatusFilter" class="filter-select" @change="applyUserFilters">
                <option value="">全部状态</option>
                <option value="active">正常</option>
                <option value="disabled">已禁用</option>
              </select>
              <select v-model="userClassFilter" class="filter-select" @change="loadUsers">
                <option value="">全部班级</option>
                <option v-for="cls in availableClasses" :key="cls.id" :value="cls.id">{{ cls.name }}</option>
              </select>
            </div>
            <div class="toolbar-right">
              <button
                v-if="isAdmin"
                class="action-btn danger-btn"
                @click="resetAllLevels"
              >重置所有人等级</button>
              <button
                v-if="selectedUsers.length > 0"
                class="action-btn"
                @click="batchBanUsers"
              >批量封禁 ({{ selectedUsers.length }})</button>
              <button
                v-if="selectedUsers.length > 0"
                class="action-btn"
                @click="batchUnbanUsers"
              >批量解禁 ({{ selectedUsers.length }})</button>
              <button
                v-if="selectedUsers.length > 0 && isAdmin"
                class="action-btn danger-btn"
                @click="batchDeleteUsers"
              >批量删除 ({{ selectedUsers.length }})</button>
              <button
                v-if="selectedUsers.length > 0 && isAdmin"
                class="action-btn"
                @click="batchToggleDeepSeek(true)"
              >批量启用DeepSeek ({{ selectedUsers.length }})</button>
              <button
                v-if="selectedUsers.length > 0 && isAdmin"
                class="action-btn"
                @click="batchToggleDeepSeek(false)"
              >批量禁用DeepSeek ({{ selectedUsers.length }})</button>
              <button class="action-btn" @click="toggleSelectAll">
                {{ isAllSelected ? '取消全选' : '全选' }}
              </button>
            </div>
          </div>

          <!-- Loading State -->
          <div v-if="usersLoading" class="loading-container">
            <div class="spinner"></div>
            <p>加载用户列表中...</p>
          </div>

          <!-- Empty State -->
          <div v-else-if="filteredUsers.length === 0 && !usersLoading" class="empty-state">
            <div class="empty-icon"><i class="fa-solid fa-users"></i></div>
            <p class="empty-text">{{ userSearch || userRoleFilter || userStatusFilter ? '未找到匹配结果' : '暂无用户' }}</p>
          </div>

          <!-- User Table -->
          <div v-else class="data-table-wrapper">
            <table class="data-table">
              <thead>
                <tr>
                  <th class="col-checkbox"><input type="checkbox" :checked="isAllSelected" @change="toggleSelectAll" /></th>
                  <th>用户ID</th>
                  <th>网名</th>
                  <th>真实姓名</th>
                  <th>角色</th>
                  <th>AI模型</th>
                  <th>DeepSeek</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(user, index) in displayedUsers"
                  :key="user.user_id"
                  :class="{ 'expanded-row': expandedUserId === user.user_id, 'row-even': index % 2 === 0 }"
                  @click="toggleUserDetail(user)"
                >
                  <td class="col-checkbox" @click.stop>
                    <input type="checkbox" :value="user.user_id" v-model="selectedUsers" :disabled="user.is_class_admin" />
                  </td>
                  <td>{{ user.user_id }}</td>
                  <td>
                    <strong>{{ user.net_name }}</strong>
                    <span v-if="user.is_admin" class="role-badge admin-badge">班管</span>

                  </td>
                  <td>{{ user.real_name || '-' }}</td>
                  <td>
                    <span v-if="user.is_admin" class="role-badge admin-badge">班管</span>

                    <span v-else class="role-badge user-badge">用户</span>
                  </td>
                  <td><span class="model-tag" :class="user.ai_model">{{ user.ai_model === 'deepseek' ? 'DeepSeek' : (user.ai_model === 'default' ? 'GPT' : user.ai_model) }}</span></td>
                  <td>
                    <label class="toggle-switch" @click.stop>
                      <input type="checkbox" :checked="user.deepseek_enabled" @change="toggleDeepSeekFromList(user, $event)">
                      <span class="toggle-slider"></span>
                    </label>
                  </td>
                  <td>
                    <span class="status-badge" :class="user.status === 'disabled' ? 'disabled' : 'active'">
                      {{ user.status === 'disabled' ? '已禁用' : '正常' }}
                    </span>
                  </td>
                  <td class="action-cell" @click.stop>
                    <template v-if="!user.is_class_admin">
                      <button v-if="isAdmin" class="table-btn sm edit" @click="editUserDetail(user)">编辑</button>
                      <button class="table-btn sm" :class="user.status === 'disabled' ? 'enable' : 'disable'" @click="toggleUser(user)">
                        {{ user.status === 'disabled' ? '解禁' : '封禁' }}
                      </button>
                      <button v-if="isAdmin" class="table-btn sm danger" @click="deleteUser(user)">删除</button>
                    </template>
                    <span v-else class="protected-hint"><i class="fa-solid fa-shield-halved"></i> 班管</span>
                  </td>
                </tr>
                <!-- User Detail Expanded Row -->
                <tr v-if="expandedUserId && expandedUserDetail && expandedUserId === expandedUserDetail.user_id" class="detail-row">
                  <td colspan="9">
                    <div class="user-detail-panel">
                      <div class="detail-grid">
                        <div class="detail-item">
                          <span class="detail-label">性别</span>
                          <span class="detail-value">{{ expandedUserDetail.gender || '未设置' }}</span>
                        </div>
                        <div class="detail-item">
                          <span class="detail-label">角色</span>
                          <span class="detail-value">
                            <span v-if="expandedUserDetail.is_admin" class="role-badge admin-badge">班管</span>
                            <span v-else>普通用户</span>
                          </span>
                        </div>
                        <div v-if="expandedUserDetail.role === 'officer' && expandedUserDetail.officer_permissions" class="detail-item">
                          <span class="detail-label">班干权限</span>
                          <span class="detail-value">
                            <span v-for="perm in parseOfficerPermissions(expandedUserDetail.officer_permissions)" :key="perm" class="perm-tag">{{ perm }}</span>
                            <span v-if="parseOfficerPermissions(expandedUserDetail.officer_permissions).length === 0">无</span>
                          </span>
                        </div>
                        <div v-if="expandedUserDetail.status === 'disabled'" class="detail-item">
                          <span class="detail-label">封禁原因</span>
                          <span class="detail-value ban-reason-text">{{ expandedUserDetail.ban_reason || '未说明' }}</span>
                        </div>
                        <div v-if="expandedUserDetail.status === 'disabled' && expandedUserDetail.ban_expires_at" class="detail-item">
                          <span class="detail-label">解封时间</span>
                          <span class="detail-value">{{ formatDate(expandedUserDetail.ban_expires_at) }}</span>
                        </div>
                        <div class="detail-item">
                          <span class="detail-label">注册时间</span>
                          <span class="detail-value">{{ formatDate(expandedUserDetail.created_at) }}</span>
                        </div>
                        <div class="detail-item">
                          <span class="detail-label">最后登录</span>
                          <span class="detail-value">{{ formatDate(expandedUserDetail.last_login) || '从未登录' }}</span>
                        </div>
                        <div class="detail-item">
                          <span class="detail-label">所属分组</span>
                          <span class="detail-value">{{ expandedUserDetail.groups ? expandedUserDetail.groups.join(', ') : '无' }}</span>
                        </div>
                      </div>
                      <div class="detail-actions-row">
                        <button v-if="isAdmin && (!expandedUserDetail.is_class_admin || expandedUserDetail.user_id === currentUser.user_id)" class="table-btn sm edit-detail-btn" @click.stop="editUserDetail(expandedUserDetail)">编辑信息</button>
                        <button v-if="isAdmin && expandedUserDetail.role !== 'officer' && !expandedUserDetail.is_admin && !expandedUserDetail.is_class_admin" class="table-btn sm" @click.stop="setAsOfficer(expandedUserDetail)">设为班干</button>
                        <button v-if="isAdmin && expandedUserDetail.role === 'officer' && !expandedUserDetail.is_admin && !expandedUserDetail.is_class_admin" class="table-btn sm" @click.stop="removeOfficer(expandedUserDetail)">撤销班干</button>
                      </div>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <!-- Load More Button -->
            <div v-if="filteredUsers.length > userPageSize" class="load-more-wrap">
              <button class="load-more-btn" @click="loadMoreUsers">
                {{ displayedUsers.length >= filteredUsers.length ? '已显示全部' : '加载更多 (' + displayedUsers.length + '/' + filteredUsers.length + ')' }}
              </button>
            </div>
          </div>
        </div>

        <!-- ========== 广播管理 ========== -->
        <div v-if="activeTab === 'permissions'" key="permissions" class="admin-section">
          <div class="perm-header">
            <h3 class="sub-title">班干管理</h3>
            <button v-if="isAdmin" class="btn-primary" @click="openAddOfficerModal">
              <i class="fa-solid fa-plus"></i> 添加班干
            </button>
          </div>
          <p class="perm-desc">班干是协助管理员管理班级的特殊角色，可分配特定管理权限。</p>

          <div v-if="officers.length > 0" class="stats-grid" style="margin-bottom:20px">
            <div class="stat-card">
              <div class="stat-icon"><i class="fa-solid fa-user-shield"></i></div>
              <div class="stat-info">
                <div class="stat-value">{{ officers.length }}</div>
                <div class="stat-label">班干数量</div>
              </div>
            </div>
            <div class="stat-card">
              <div class="stat-icon"><i class="fa-solid fa-key"></i></div>
              <div class="stat-info">
                <div class="stat-value">{{ totalActivePermissions }}</div>
                <div class="stat-label">已分配权限</div>
              </div>
            </div>
            <div class="stat-card">
              <div class="stat-icon"><i class="fa-solid fa-shield-halved"></i></div>
              <div class="stat-info">
                <div class="stat-value">{{ permissionOptions.length }}</div>
                <div class="stat-label">可用权限</div>
              </div>
            </div>
          </div>

          <div v-if="officers.length === 0" class="perm-empty">
            <i class="fa-solid fa-user-shield"></i>
            <p>暂无班干</p>
          </div>

          <div v-else class="officer-list">
            <div v-for="officer in officers" :key="officer.user_id" class="officer-card">
              <div class="officer-info">
                <div class="officer-avatar">
                  <i class="fa-solid fa-user-tie"></i>
                </div>
                <div class="officer-detail">
                  <div class="officer-name">{{ officer.net_name }}<span v-if="officer.officer_title" class="officer-title-badge">{{ officer.officer_title }}</span></div>
                  <div class="officer-id">{{ officer.real_name }} ({{ officer.user_id }})</div>
                  <div class="officer-perm-count">{{ (officer.officer_permissions || []).length }} 项权限</div>
                </div>
              </div>
              <div class="officer-perms">
                <div v-if="editingOfficerId === officer.user_id" class="officer-title-edit">
                  <input class="form-input" v-model="editingOfficerTitle" placeholder="头衔，如：班长、英语课代表" style="margin-bottom:8px" />
                </div>
                <span
                  v-for="perm in permissionOptions"
                  :key="perm.key"
                  class="perm-tag"
                  :class="{
                    active: editingOfficerId === officer.user_id
                      ? editingPermissions.indexOf(perm.key) > -1
                      : (officer.officer_permissions || []).indexOf(perm.key) > -1,
                    editing: editingOfficerId === officer.user_id
                  }"
                  @click="editingOfficerId === officer.user_id && togglePermission(perm.key, 'edit')"
                >
                  <i :class="perm.icon"></i> {{ perm.label }}
                </span>
              </div>
              <div class="officer-actions">
                <template v-if="editingOfficerId === officer.user_id">
                  <button class="table-btn sm" @click="savePermissions">保存</button>
                  <button class="table-btn sm" @click="cancelEditPermissions">取消</button>
                </template>
                <template v-else>
                  <button class="table-btn sm" @click="startEditPermissions(officer)">编辑权限</button>
                  <button v-if="isAdmin" class="table-btn sm danger" @click="removeOfficer(officer.user_id)">移除</button>
                </template>
              </div>
            </div>
          </div>

          <!-- Add Officer Modal -->
          <transition name="modal-fade">
            <div v-if="showAddOfficerModal" class="modal-overlay" @click.self="showAddOfficerModal = false">
              <div class="modal-card" @click.stop>
                <h3 class="modal-title">添加班干</h3>
                <div class="form-group">
                  <label class="form-label">选择用户</label>
                  <select v-model="addOfficerUserId" class="form-input">
                    <option value="">-- 请选择 --</option>
                    <option v-for="u in availableUsers" :key="u.user_id" :value="u.user_id">
                      {{ u.real_name }} ({{ u.user_id }}) - {{ u.net_name }}
                    </option>
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">头衔</label>
                  <input class="form-input" v-model="addOfficerTitle" placeholder="例如：班长、英语课代表" />
                </div>
                <div class="form-group">
                  <label class="form-label">分配权限</label>
                  <div class="perm-select-grid">
                    <span
                      v-for="perm in permissionOptions"
                      :key="perm.key"
                      class="perm-tag selectable"
                      :class="{ active: addOfficerPermissions.indexOf(perm.key) > -1 }"
                      @click="togglePermission(perm.key, 'add')"
                    >
                      <i :class="perm.icon"></i> {{ perm.label }}
                    </span>
                  </div>
                </div>
                <div class="modal-actions">
                  <button class="btn-cancel" @click="showAddOfficerModal = false">取消</button>
                  <button class="btn-confirm" @click="confirmAddOfficer">确定</button>
                </div>
              </div>
            </div>
          </transition>
        </div>

        <div v-if="activeTab === 'announcements'" key="announcements" class="admin-section">
          <div class="ann-admin-form">
            <h3 class="sub-title">发布公告 / 作业</h3>
            <div class="form-group">
              <label class="form-label">类型</label>
              <select v-model="newAnnType" class="form-input">
                <option value="notice">公告</option>
                <option value="homework">作业</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">标题</label>
              <input v-model="newAnnTitle" class="form-input" placeholder="输入标题..." />
            </div>
            <div class="form-group">
              <label class="form-label">内容</label>
              <textarea v-model="newAnnContent" class="form-input" rows="4" placeholder="输入内容..."></textarea>
            </div>
            <button class="btn-primary" @click="createAnnouncement" :disabled="!newAnnTitle.trim() || !newAnnContent.trim()">发布</button>
          </div>

          <h3 class="sub-title" style="margin-top: 24px;">已发布公告</h3>
          <div v-if="adminAnnouncements.length === 0" class="perm-empty">
            <p>暂无公告</p>
          </div>
          <div v-else class="ann-admin-list">
            <div v-for="item in adminAnnouncements" :key="item.id" class="ann-admin-item" :class="{ pinned: item.pinned }">
              <div class="ann-admin-item-header">
                <div class="ann-admin-item-badges">
                  <span v-if="item.pinned" class="ann-badge pin-badge"><i class="fa-solid fa-thumbtack"></i> 置顶</span>
                  <span class="ann-badge" :class="item.type === 'homework' ? 'hw-badge' : 'notice-badge'">
                    {{ item.type === 'homework' ? '作业' : '公告' }}
                  </span>
                </div>
                <span class="ann-admin-item-time">{{ item.created_at }}</span>
              </div>
              <div class="ann-admin-item-title">{{ item.title }}</div>
              <div class="ann-admin-item-content">{{ item.content }}</div>
              <div class="ann-admin-item-footer">
                <span class="ann-admin-item-author">{{ item.author_name }}</span>
                <div class="ann-admin-item-actions">
                  <button class="table-btn sm" @click="startEditAnnouncement(item)">编辑</button>
                  <button class="table-btn sm" @click="togglePinAnnouncement(item.id, item.pinned)">
                    {{ item.pinned ? '取消置顶' : '置顶' }}
                  </button>
                  <button class="table-btn sm danger" @click="deleteAnnouncement(item.id)">删除</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="activeTab === 'broadcast'" key="broadcast" class="admin-section">
          <div class="broadcast-form">
            <h3 class="sub-title">发送广播</h3>
            <textarea v-model="broadcastContent" class="broadcast-input" placeholder="输入广播内容..." rows="3"></textarea>
            <button class="btn-primary" @click="sendBroadcast" :disabled="!broadcastContent.trim()">发送广播</button>
            <button v-if="isClassAdmin" class="btn-primary btn-danger" @click="showClearChat" style="margin-left: 12px;">
              <i class="fa-solid fa-trash-can"></i> 清除聊天记录
            </button>
          </div>
        </div>

        <!-- ========== 服务器状态 ========== -->
        <div v-if="activeTab === 'server'" key="server" class="admin-section">
          <div v-if="statsLoading && !serverStats" class="loading-container">
            <div class="spinner"></div>
            <p>加载服务器状态...</p>
          </div>
          <template v-else>
            <div class="stats-overview">
              <div class="stat-card">
                <div class="stat-icon"><i class="fa-solid fa-users"></i></div>
                <div class="stat-info">
                  <span class="stat-value">{{ serverStats.total_users || 0 }}</span>
                  <span class="stat-label">总用户数</span>
                </div>
              </div>
              <div class="stat-card">
                <div class="stat-icon"><i class="fa-solid fa-user-check"></i></div>
                <div class="stat-info">
                  <span class="stat-value">{{ serverStats.online_users || 0 }}</span>
                  <span class="stat-label">在线用户</span>
                </div>
              </div>
              <div class="stat-card">
                <div class="stat-icon"><i class="fa-solid fa-hard-drive"></i></div>
                <div class="stat-info">
                  <span class="stat-value">{{ serverStats.storage_used || '0 MB' }}</span>
                  <span class="stat-label">存储用量</span>
                </div>
              </div>
              <div class="stat-card">
                <div class="stat-icon"><i class="fa-solid fa-clock-rotate-left"></i></div>
                <div class="stat-info">
                  <span class="stat-value">{{ serverStats.last_user_login || '-' }}</span>
                  <span class="stat-label">最近登录</span>
                </div>
              </div>
            </div>

            <div class="monitor-grid">
              <div class="monitor-card">
                <div class="monitor-label">CPU 使用率</div>
                <div class="progress-bar">
                  <div class="progress-fill" :style="{ width: serverStats.cpu + '%' }" :class="getBarClass(serverStats.cpu)"></div>
                </div>
                <div class="monitor-value">{{ serverStats.cpu }}%</div>
              </div>
              <div class="monitor-card">
                <div class="monitor-label">内存使用率</div>
                <div class="progress-bar">
                  <div class="progress-fill" :style="{ width: serverStats.memory + '%' }" :class="getBarClass(serverStats.memory)"></div>
                </div>
                <div class="monitor-value">{{ serverStats.memory }}%</div>
              </div>
              <div class="monitor-card">
                <div class="monitor-label">磁盘使用率</div>
                <div class="progress-bar">
                  <div class="progress-fill" :style="{ width: serverStats.disk + '%' }" :class="getBarClass(serverStats.disk)"></div>
                </div>
                <div class="monitor-value">{{ serverStats.disk }}%</div>
              </div>
            </div>

            <div class="monitor-info">
              <div class="info-item">
                <span class="info-label">系统运行时间</span>
                <span class="info-value">{{ serverStats.uptime || '-' }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">系统版本</span>
                <span class="info-value">{{ serverStats.version || '1.0.0' }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">分组数量</span>
                <span class="info-value">{{ serverStats.group_count || 0 }}</span>
              </div>
            </div>

            <template v-if="isAdmin">
            <div class="section-divider"></div>

            <div class="section-toolbar">
              <div class="toolbar-left">
                <h3 style="margin:0;font-size:16px;"><i class="fa-solid fa-microchip" style="margin-right:6px;"></i>PM2 进程管理</h3>
              </div>
              <div class="toolbar-right">
                <button class="action-btn" @click="pm2Action('start')" :disabled="pm2ActionLoading || (pm2Process && pm2Process.status === 'online')">
                  <i class="fa-solid fa-play"></i> Start
                </button>
                <button class="action-btn" @click="pm2Action('restart')" :disabled="pm2ActionLoading || !pm2Process || pm2Process.status !== 'online'" style="background:var(--warning-color);color:var(--card-bg);">
                  <i class="fa-solid fa-rotate-right"></i> Restart
                </button>
                <button class="action-btn danger-btn" @click="pm2Action('stop')" :disabled="pm2ActionLoading || !pm2Process || pm2Process.status !== 'online'">
                  <i class="fa-solid fa-stop"></i> Stop
                </button>
                <button class="action-btn" @click="pm2Action('flush-logs')" :disabled="pm2ActionLoading">
                  <i class="fa-solid fa-eraser"></i> Flush Logs
                </button>
                <button class="action-btn" @click="loadPM2Status">
                  <i class="fa-solid fa-refresh"></i>
                </button>
              </div>
            </div>

            <div v-if="pm2Loading && !pm2Status" class="loading-container" style="padding:20px;">
              <div class="spinner"></div>
              <p>连接 PM2...</p>
            </div>
            <template v-else-if="pm2Status && pm2Process">
              <div class="pm2-process-card">
                <div class="pm2-header">
                  <div class="pm2-status-badge" :class="pm2Process.status">{{ pm2Process.status.toUpperCase() }}</div>
                  <span class="pm2-name">{{ pm2Process.name }}</span>
                  <span class="pm2-mode">{{ pm2Process.mode }}</span>
                  <span class="pm2-pid">PID: {{ pm2Process.pid || '-' }}</span>
                </div>
                <div class="pm2-metrics">
                  <div class="pm2-metric">
                    <span class="pm2-metric-label">进程 CPU</span>
                    <div class="progress-bar" style="flex:1;">
                      <div class="progress-fill" :style="{ width: Math.min(pm2Process.cpu, 100) + '%' }" :class="getBarClass(pm2Process.cpu)"></div>
                    </div>
                    <span class="pm2-metric-value">{{ pm2Process.cpu }}%</span>
                  </div>
                  <div class="pm2-metric">
                    <span class="pm2-metric-label">进程内存</span>
                    <div class="progress-bar" style="flex:1;">
                      <div class="progress-fill" :style="{ width: pm2MemPercent + '%' }" :class="getBarClass(pm2MemPercent)"></div>
                    </div>
                    <span class="pm2-metric-value">{{ formatBytes(pm2Process.memory) }}</span>
                  </div>
                </div>
                <div class="pm2-details">
                  <div class="info-item"><span class="info-label">重启次数</span><span class="info-value">{{ pm2Process.restarts }}</span></div>
                  <div class="info-item"><span class="info-label">进程运行时间</span><span class="info-value">{{ formatPM2Uptime(pm2Process.uptime) }}</span></div>
                  <div class="info-item"><span class="info-label">内存限制</span><span class="info-value">{{ pm2Process.memory_limit || '1G' }}</span></div>
                  <div class="info-item"><span class="info-label">Node 版本</span><span class="info-value">{{ pm2Process.node_version || '-' }}</span></div>
                </div>
              </div>
            </template>
            <div v-else-if="!pm2Status" class="empty-state" style="padding:16px;">
              <div class="empty-icon"><i class="fa-solid fa-server"></i></div>
              <p class="empty-text">无法连接 PM2</p>
              <button class="action-btn" @click="loadPM2Status" style="margin-top:8px;">重试</button>
            </div>

            <div class="pm2-logs-section">
              <div class="section-toolbar" style="margin-top:16px;">
                <div class="toolbar-left">
                  <button class="action-btn" :class="{ 'active': pm2LogsTab === 'out' }" @click="pm2LogsTab = 'out'; loadPM2Logs()">输出日志</button>
                  <button class="action-btn" :class="{ 'active': pm2LogsTab === 'error' }" @click="pm2LogsTab = 'error'; loadPM2Logs()">错误日志</button>
                </div>
                <div class="toolbar-right">
                  <button class="action-btn" @click="loadPM2Logs"><i class="fa-solid fa-refresh"></i></button>
                </div>
              </div>
              <div class="pm2-log-viewer scrollbar-thin">
                <div v-if="pm2LogsLoading" class="loading-container" style="padding:20px;"><div class="spinner"></div></div>
                <template v-else-if="pm2Logs">
                  <div v-for="(line, i) in (pm2LogsTab === 'out' ? pm2Logs.out : pm2Logs.error)" :key="i" class="pm2-log-line" :class="{ 'pm2-log-error': pm2LogsTab === 'error' }">{{ line }}</div>
                  <div v-if="(pm2LogsTab === 'out' ? pm2Logs.out : pm2Logs.error).length === 0" class="empty-state" style="padding:20px;">
                    <p class="empty-text">暂无日志</p>
                  </div>
                </template>
              </div>
            </div>
            <p class="auto-refresh-hint">系统状态每5秒刷新<template v-if="isAdmin"> · PM2状态每10秒刷新</template></p>
            </template>
          </template>
        </div>

        <!-- ========== 联动状态 ========== -->
        <div v-if="activeTab === 'relay'" key="relay" class="admin-section">
          <div v-if="relayLoading" class="loading-container">
            <i class="fa-solid fa-spinner fa-spin"></i> 加载中...
          </div>
          <div v-else-if="relayStatus" class="relay-status-panel">
            <!-- 服务器模式切换 -->
            <div class="relay-info-card" style="grid-column: 1 / -1;">
              <div class="relay-info-label">服务器模式</div>
              <div class="relay-info-value" style="display:flex;align-items:center;gap:12px;">
                <button
                  :class="['mode-btn', serverMode === 'single' ? 'mode-btn-active' : '']"
                  @click="switchServerMode('single')"
                  :disabled="serverModeLoading">
                  <i class="fa-solid fa-server"></i> 单服务器
                </button>
                <button
                  :class="['mode-btn', serverMode === 'multi' ? 'mode-btn-active' : '']"
                  @click="switchServerMode('multi')"
                  :disabled="serverModeLoading">
                  <i class="fa-solid fa-link"></i> 多服务器联动
                </button>
                <span v-if="serverModeLoading" style="font-size:12px;color:rgba(255,255,255,0.5);">切换中...</span>
              </div>
              <div style="margin-top:8px;font-size:12px;color:rgba(255,255,255,0.4);">
                单服务器模式：仅本班使用，不连接其他服务器<br>
                多服务器模式：支持与其他班级联动（最多2个班级）
              </div>
            </div>
            <div class="relay-info-card">
              <div class="relay-info-label">本服务器 ID</div>
              <div class="relay-info-value">{{ relayStatus.server_id || '未配置' }}</div>
            </div>
            <div class="relay-info-card">
              <div class="relay-info-label">对端服务器连接</div>
              <div class="relay-info-value">
                <div v-if="relayStatus.connected_peers && relayStatus.connected_peers.length > 0" class="peer-list">
                  <div v-for="peer in relayStatus.connected_peers" :key="peer.server_id" class="peer-item">
                    <span class="peer-name">{{ peer.server_id }}</span>
                    <span :class="peer.state === 1 ? 'status-active' : 'status-inactive'">{{ peer.state === 1 ? '已连接' : peer.state === 0 ? '连接中' : '已断开' }}</span>
                  </div>
                </div>
                <div v-else-if="relayStatus.configured_peers && relayStatus.configured_peers.length > 0" class="peer-list">
                  <div v-for="addr in relayStatus.configured_peers" :key="addr" class="peer-item">
                    <span class="peer-name">{{ addr }}</span>
                    <span class="status-inactive">未连接</span>
                  </div>
                </div>
                <span v-else class="text-muted">未配置</span>
              </div>
            </div>
            <div class="relay-info-card">
              <div class="relay-info-label">远程在线用户数</div>
              <div class="relay-info-value">{{ relayStatus.remote_online_count }}</div>
            </div>
            <div class="relay-info-card">
              <div class="relay-info-label">联动状态</div>
              <div class="relay-info-value">
                <span v-if="relayStatus.connected_peers && relayStatus.connected_peers.length > 0 && relayStatus.connected_peers.some(function(p) { return p.state === 1 })" class="status-active">已连接</span>
                <span v-else-if="relayStatus.configured_peers && relayStatus.configured_peers.length > 0" class="status-pending">等待连接</span>
                <span v-else class="text-muted">未启用</span>
              </div>
            </div>
            <div v-if="relayStatus.sync_status" class="relay-sync-section">
              <h3 class="sub-title">数据同步状态</h3>
              <div class="relay-info-card">
                <div class="relay-info-label">上次同步时间</div>
                <div class="relay-info-value">{{ relayStatus.sync_status.last_sync_time ? formatDate(relayStatus.sync_status.last_sync_time) : '尚未同步' }}</div>
              </div>
              <div v-if="relayStatus.sync_status.last_sync_result" class="relay-info-card sync-result-card">
                <div class="relay-info-label">上次同步结果</div>
                <div class="sync-result-grid">
                  <div v-if="relayStatus.sync_status.last_sync_result.chat > 0" class="sync-item"><i class="fa-solid fa-comment"></i> 聊天 {{ relayStatus.sync_status.last_sync_result.chat }}</div>
                  <div v-if="relayStatus.sync_status.last_sync_result.pm > 0" class="sync-item"><i class="fa-solid fa-envelope"></i> 私聊 {{ relayStatus.sync_status.last_sync_result.pm }}</div>
                  <div v-if="relayStatus.sync_status.last_sync_result.gm > 0" class="sync-item"><i class="fa-solid fa-users"></i> 群聊 {{ relayStatus.sync_status.last_sync_result.gm }}</div>
                  <div v-if="relayStatus.sync_status.last_sync_result.posts > 0" class="sync-item"><i class="fa-solid fa-newspaper"></i> 帖子 {{ relayStatus.sync_status.last_sync_result.posts }}</div>
                  <div v-if="relayStatus.sync_status.last_sync_result.comments > 0" class="sync-item"><i class="fa-solid fa-reply"></i> 评论 {{ relayStatus.sync_status.last_sync_result.comments }}</div>
                  <div v-if="relayStatus.sync_status.last_sync_result.likes > 0" class="sync-item"><i class="fa-solid fa-heart"></i> 点赞 {{ relayStatus.sync_status.last_sync_result.likes }}</div>
                  <div v-if="relayStatus.sync_status.last_sync_result.reactions > 0" class="sync-item"><i class="fa-solid fa-face-smile"></i> 表情 {{ relayStatus.sync_status.last_sync_result.reactions }}</div>
                  <div v-if="relayStatus.sync_status.last_sync_result.bookmarks > 0" class="sync-item"><i class="fa-solid fa-bookmark"></i> 收藏 {{ relayStatus.sync_status.last_sync_result.bookmarks }}</div>
                  <div v-if="relayStatus.sync_status.last_sync_result.exp_logs > 0" class="sync-item"><i class="fa-solid fa-bolt"></i> 经验 {{ relayStatus.sync_status.last_sync_result.exp_logs }}</div>
                  <div v-if="relayStatus.sync_status.last_sync_result.broadcasts > 0" class="sync-item"><i class="fa-solid fa-bullhorn"></i> 广播 {{ relayStatus.sync_status.last_sync_result.broadcasts }}</div>
                  <div v-if="relayStatus.sync_status.last_sync_result.users > 0" class="sync-item"><i class="fa-solid fa-user"></i> 用户 {{ relayStatus.sync_status.last_sync_result.users }}</div>
                  <div v-if="relayStatus.sync_status.last_sync_result.groups > 0" class="sync-item"><i class="fa-solid fa-people-group"></i> 群组 {{ relayStatus.sync_status.last_sync_result.groups }}</div>
                  <div v-if="relayStatus.sync_status.last_sync_result.user_experience > 0" class="sync-item"><i class="fa-solid fa-star"></i> 经验数据 {{ relayStatus.sync_status.last_sync_result.user_experience }}</div>
                  <div v-if="relayStatus.sync_status.last_sync_result.user_settings > 0" class="sync-item"><i class="fa-solid fa-gear"></i> 用户设置 {{ relayStatus.sync_status.last_sync_result.user_settings }}</div>
                </div>
                <div v-if="isSyncEmpty(relayStatus.sync_status.last_sync_result)" class="text-muted" style="margin-top:8px;font-size:13px;">数据已是最新</div>
              </div>
              <div v-if="relayStatus.sync_status.sync_state" class="relay-info-card">
                <div class="relay-info-label">本地数据水位</div>
                <div class="sync-state-grid">
                  <span>聊天: {{ relayStatus.sync_status.sync_state.last_chat_id || 0 }}</span>
                  <span>私聊: {{ relayStatus.sync_status.sync_state.last_pm_id || 0 }}</span>
                  <span>群聊: {{ relayStatus.sync_status.sync_state.last_gm_id || 0 }}</span>
                  <span>帖子: {{ relayStatus.sync_status.sync_state.last_post_id || 0 }}</span>
                  <span>评论: {{ relayStatus.sync_status.sync_state.last_comment_id || 0 }}</span>
                  <span>表情: {{ relayStatus.sync_status.sync_state.last_reaction_id || 0 }}</span>
                  <span>收藏: {{ relayStatus.sync_status.sync_state.last_bookmark_id || 0 }}</span>
                  <span>经验: {{ relayStatus.sync_status.sync_state.last_exp_log_id || 0 }}</span>
                  <span>用户: {{ relayStatus.sync_status.sync_state.user_count || 0 }}</span>
                  <span>群组: {{ relayStatus.sync_status.sync_state.last_group_watermark || 0 }}</span>
                </div>
              </div>
            </div>
            <div class="relay-actions">
              <button class="relay-action-btn" @click="triggerSync" :disabled="relayStatus && relayStatus.connected_peers && relayStatus.connected_peers.length === 0">
                <i class="fa-solid fa-arrows-rotate"></i> 触发同步
              </button>
              <button v-if="relayStatus && relayStatus.relay_enabled !== false && relayStatus.connected_peers && relayStatus.connected_peers.length > 0"
                class="relay-action-btn relay-action-disconnect" @click="disconnectRelay">
                <i class="fa-solid fa-link-slash"></i> 断开连接
              </button>
              <button v-if="serverMode === 'multi' && relayStatus && relayStatus.connected_peers && relayStatus.connected_peers.length === 0"
                class="relay-action-btn relay-action-connect" @click="connectRelay">
                <i class="fa-solid fa-plug"></i> 手动连接
              </button>
              <button class="relay-action-btn" @click="checkConsistency">
                <i class="fa-solid fa-stethoscope"></i> 一致性检查
              </button>
            </div>
          </div>
          <div v-else class="empty-state">
            <p>无法获取联动状态</p>
          </div>

          <!-- Syncthing 同步状态 -->
          <div v-if="syncthingStatus" class="relay-status-panel" style="margin-top: 20px;">
            <h3 class="sub-title"><i class="fa-solid fa-arrows-rotate"></i> Syncthing 代码同步</h3>
            <div v-if="syncthingStatus.error" class="relay-info-card">
              <div class="relay-info-value status-inactive">{{ syncthingStatus.error }}</div>
            </div>
            <div v-else-if="!syncthingStatus.configured" class="relay-info-card">
              <div class="relay-info-value text-muted">{{ syncthingStatus.message || '未配置' }}</div>
            </div>
            <template v-else>
              <div class="relay-info-card">
                <div class="relay-info-label">版本</div>
                <div class="relay-info-value">{{ syncthingStatus.version || '未知' }}</div>
              </div>
              <div class="relay-info-card">
                <div class="relay-info-label">运行时间</div>
                <div class="relay-info-value">{{ formatUptime(syncthingStatus.uptime) }}</div>
              </div>
              <div v-if="syncthingStatus.folders && syncthingStatus.folders.length > 0" class="relay-info-card">
                <div class="relay-info-label">同步文件夹</div>
                <div class="relay-info-value">
                  <div v-for="folder in syncthingStatus.folders" :key="folder.id" class="peer-item" style="flex-direction: column; align-items: flex-start; gap: 4px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                      <span class="peer-name">{{ folder.label || folder.id }}</span>
                      <span :class="folder.state === 'idle' ? 'status-active' : folder.state === 'syncing' ? 'status-pending' : 'status-inactive'">{{ folder.state === 'idle' ? '空闲' : folder.state === 'syncing' ? '同步中' : folder.state === 'scanning' ? '扫描中' : folder.state }}</span>
                    </div>
                    <div style="font-size:12px;color:rgba(255,255,255,0.5);">{{ folder.path }} · {{ folder.globalFiles }} 文件</div>
                    <div v-if="folder.needFiles > 0" style="font-size:12px;color:#f59e0b;">待同步: {{ folder.needFiles }} 文件</div>
                  </div>
                </div>
              </div>
              <div v-if="syncthingStatus.errors && syncthingStatus.errors.length > 0" class="relay-info-card">
                <div class="relay-info-label">错误</div>
                <div class="relay-info-value status-inactive">{{ syncthingStatus.errors.join(', ') }}</div>
              </div>
            </template>
          </div>

          <!-- Tailscale 网络状态 -->
          <div v-if="tailscaleStatus" class="relay-status-panel" style="margin-top: 20px;">
            <h3 class="sub-title"><i class="fa-solid fa-network-wired"></i> Tailscale 虚拟组网</h3>
            <div v-if="tailscaleStatus.error" class="relay-info-card">
              <div class="relay-info-value status-inactive">{{ tailscaleStatus.error }}</div>
            </div>
            <div v-else-if="!tailscaleStatus.enabled" class="relay-info-card">
              <div class="relay-info-value text-muted">{{ tailscaleStatus.message || '未启用' }}</div>
            </div>
            <template v-else>
              <div class="relay-info-card">
                <div class="relay-info-label">本机信息</div>
                <div class="relay-info-value">
                  <div v-if="tailscaleStatus.self" style="display:flex;flex-direction:column;gap:4px;">
                    <span>{{ tailscaleStatus.self.hostname || '未知' }}</span>
                    <span v-if="tailscaleStatus.self.tailscaleIPs && tailscaleStatus.self.tailscaleIPs.length > 0" style="font-size:13px;color:rgba(255,255,255,0.6);">{{ tailscaleStatus.self.tailscaleIPs.join(', ') }}</span>
                    <span :class="tailscaleStatus.self.online ? 'status-active' : 'status-inactive'">{{ tailscaleStatus.self.online ? '在线' : '离线' }}</span>
                  </div>
                  <span v-else class="text-muted">无法获取</span>
                </div>
              </div>
              <div v-if="tailscaleStatus.relay_ip" class="relay-info-card">
                <div class="relay-info-label">Relay 对端 IP</div>
                <div class="relay-info-value">{{ tailscaleStatus.relay_ip }}</div>
              </div>
              <div v-if="tailscaleStatus.peers && tailscaleStatus.peers.length > 0" class="relay-info-card">
                <div class="relay-info-label">网络节点</div>
                <div class="relay-info-value">
                  <div v-for="peer in tailscaleStatus.peers" :key="peer.dnsName" class="peer-item">
                    <span class="peer-name">{{ peer.hostname }}</span>
                    <span v-if="peer.tailscaleIPs && peer.tailscaleIPs.length > 0" style="font-size:12px;color:rgba(255,255,255,0.5);margin-right:8px;">{{ peer.tailscaleIPs[0] }}</span>
                    <span :class="peer.online ? 'status-active' : 'status-inactive'">{{ peer.online ? '在线' : '离线' }}</span>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>

        <!-- ========== 操作日志 ========== -->
        <div v-if="activeTab === 'logs'" key="logs" class="admin-section">
          <div v-if="logsLoading" class="loading-container">
            <div class="spinner"></div>
            <p>加载日志中...</p>
          </div>
          <div v-else-if="adminLogs.length === 0" class="empty-state">
            <div class="empty-icon"><i class="fa-solid fa-scroll"></i></div>
            <p class="empty-text">暂无操作日志</p>
          </div>
          <div v-else class="logs-list">
            <div v-for="log in mergedAdminLogs" :key="log.id" class="log-item" :class="{ 'log-merged': log.merged }">
              <div class="log-header">
                <span class="log-action" :class="getLogActionClass(log.action)">
                  {{ getLogActionLabel(log.action) }}
                  <span v-if="log.count > 1" class="log-count">&times;{{ log.count }}</span>
                </span>
                <span class="log-time">
                  <template v-if="log.count > 1">{{ formatDate(log.earliestTime) }} ~ {{ formatDate(log.latestTime) }}</template>
                  <template v-else>{{ formatDate(log.created_at) }}</template>
                </span>
              </div>
              <div class="log-body">
                <span class="log-admin">管理员: {{ log.admin_id }}</span>
                <span v-if="log.target" class="log-target">对象: {{ log.target }}</span>
                <span v-if="log.detail" class="log-detail">{{ log.detail }}</span>
              </div>
            </div>
            <div v-if="logsTotal > logsLimit" class="load-more-wrap">
              <button class="load-more-btn" @click="loadMoreLogs">
                {{ adminLogs.length >= logsTotal ? '已显示全部' : '加载更多 (' + adminLogs.length + '/' + logsTotal + ')' }}
              </button>
            </div>
          </div>
        </div>

        <!-- ========== 资源管理 ========== -->
        <div v-if="activeTab === 'resources'" key="resources" class="admin-section">
          <div class="section-toolbar resource-toolbar">
            <div class="breadcrumb">
              <span v-for="(crumb, idx) in resourceBreadcrumbs" :key="idx">
                <a v-if="idx < resourceBreadcrumbs.length - 1" href="javascript:void(0)" @click="navigateResource(crumb.path || '/')">{{ crumb.name }}</a>
                <span v-else>{{ crumb.name }}</span>
                <span v-if="idx < resourceBreadcrumbs.length - 1"> / </span>
              </span>
            </div>
            <div class="resource-stats-bar">
              <span class="res-stat">{{ resourceItems.length }} 个文件</span>
              <span class="res-stat">总计 {{ totalResourceSize }}</span>
            </div>
          </div>
          <div class="section-toolbar toolbar-actions-row">
            <input
              v-model="resourceSearch"
              class="search-input-sm"
              placeholder="搜索文件..."
              @input="onResourceSearchInput"
            />
            <select v-model="resourceTypeFilter" class="filter-select-sm">
              <option value="">全部类型</option>
              <option value="image">图片</option>
              <option value="document">文档</option>
              <option value="html">网页</option>
              <option value="video">视频</option>
              <option value="audio">音频</option>
            </select>
            <select v-model="resourceSortBy" class="filter-select-sm">
              <option value="name_asc">名称 ↑</option>
              <option value="name_desc">名称 ↓</option>
              <option value="size_desc">大小 ↓</option>
              <option value="size_asc">大小 ↑</option>
              <option value="date_desc">日期 ↓</option>
              <option value="date_asc">日期 ↑</option>
            </select>
            <button class="action-btn" @click="showCreateFolder = true">新建文件夹</button>
            <button class="action-btn" @click="goResourceBack" :disabled="resourcePath === '/'">返回上级</button>
            <label class="toggle-switch-sm">
              <input type="checkbox" v-model="videoFolderVisible" @change="toggleVideoFolderVisible" />
              <span class="toggle-slider-sm"></span>
              <span class="toggle-label-sm">视频文件夹</span>
            </label>
            <label class="toggle-switch-sm">
              <input type="checkbox" v-model="musicFolderVisible" @change="toggleMusicFolderVisible" />
              <span class="toggle-slider-sm"></span>
              <span class="toggle-label-sm">音乐文件夹</span>
            </label>
          </div>

          <!-- Loading State -->
          <div v-if="resourcesLoading" class="loading-container">
            <div class="spinner"></div>
            <p>加载资源列表中...</p>
          </div>

          <!-- Search Results -->
          <div v-else-if="resourceSearchMode && resourceSearchResults.length > 0" class="resource-list">
            <div v-for="item in resourceSearchResults" :key="item.path" class="resource-row">
              <span class="res-icon"><i :class="getResourceIcon(item)" class="res-fa-icon"></i></span>
              <span class="res-name" @click="item.is_dir && navigateResource(item.path)">{{ item.name }}</span>
              <span class="res-path">{{ item.path }}</span>
              <span class="res-size">{{ item.is_dir ? '--' : formatSize(item.size) }}</span>
              <span class="res-actions">
                <button class="table-btn sm" @click="navigateResource(item.path)">打开</button>
              </span>
            </div>
          </div>

          <!-- Normal Resource List -->
          <div v-else class="resource-list">
            <div v-if="filteredResourceItems.length === 0" class="empty-state">
              <div class="empty-icon"><i class="fa-solid fa-folder-open"></i></div>
              <p class="empty-text">{{ resourceTypeFilter || resourceSearch ? '未找到匹配结果' : '此目录为空' }}</p>
            </div>
            <div v-for="item in filteredResourceItems" :key="item.name" class="resource-row">
              <span class="res-icon"><i :class="getResourceIcon(item)" class="res-fa-icon"></i></span>
              <span class="res-name" @click="item.is_dir ? navigateResource(buildResourcePath(item.name)) : null">{{ item.name }}</span>
              <span class="res-size">{{ item.is_dir ? '--' : formatSize(item.size) }}</span>
              <span class="res-date">{{ formatDate(item.modified) }}</span>
              <span class="res-actions">
                <button class="table-btn sm" @click="renameResource(item)">重命名</button>
                <button class="table-btn sm" @click="moveResource(item)">移动</button>
                <button class="table-btn sm" @click="copyResource(item)">复制</button>
                <button class="table-btn sm danger" @click="deleteResource(item)">删除</button>
              </span>
            </div>
          </div>
        </div>

        <!-- ========== 天气提醒设置 ========== -->
        <div v-if="activeTab === 'weather'" key="weather" class="admin-section">
          <div class="section-toolbar">
            <div class="toolbar-left">
              <h3 class="sub-title"><i class="fa-solid fa-cloud-sun-rain" style="margin-right:6px"></i>天气提醒设置</h3>
            </div>
            <div class="toolbar-right">
              <button class="admin-btn primary" @click="checkWeatherNow"><i class="fa-solid fa-magnifying-glass"></i> 立即检查天气</button>
            </div>
          </div>
          <p class="perm-desc">设置定时获取天气信息的时间，如有降雨或预警则自动在超能岛上显示提醒。</p>

          <div class="weather-schedule-section">
            <div class="schedule-add-row">
              <input v-model="newScheduleTime" type="time" class="form-input" style="width:140px" />
              <button class="admin-btn primary" @click="addWeatherSchedule"><i class="fa-solid fa-plus"></i> 添加时间</button>
            </div>
            <div v-if="weatherSchedules.length === 0" class="admin-empty">暂无提醒时间，请添加</div>
            <table v-else class="admin-table">
              <thead>
                <tr>
                  <th>提醒时间</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="s in weatherSchedules" :key="s.id">
                  <td><strong>{{ s.schedule_time }}</strong></td>
                  <td>
                    <label class="toggle-switch" @click.stop>
                      <input type="checkbox" :checked="s.enabled" @change="toggleWeatherSchedule(s)">
                      <span class="toggle-slider"></span>
                    </label>
                  </td>
                  <td>
                    <button class="admin-btn sm danger" @click="deleteWeatherSchedule(s.id)">删除</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-if="weatherCheckResult" class="weather-check-result">
            <div class="card-label" style="margin-bottom:8px">天气检查结果</div>
            <div class="check-result-grid">
              <div class="check-item" :class="{ 'has-alert': weatherCheckResult.has_rain }">
                <span class="check-label">降雨</span>
                <span class="check-value">{{ weatherCheckResult.has_rain ? weatherCheckResult.rain_text : '无降雨' }}</span>
              </div>
              <div class="check-item" :class="{ 'has-alert': weatherCheckResult.has_warning }">
                <span class="check-label">预警</span>
                <span class="check-value">
                  <template v-if="weatherCheckResult.has_warning">
                    <span v-for="(w, i) in weatherCheckResult.warnings" :key="i" class="warning-tag">{{ w.title || w.typeName }}</span>
                  </template>
                  <template v-else>无预警</template>
                </span>
              </div>
            </div>
            <div v-if="weatherCheckResult.has_rain || weatherCheckResult.has_warning" style="margin-top:10px">
              <button class="admin-btn primary" @click="broadcastWeatherAlert"><i class="fa-solid fa-bullhorn"></i> 手动广播提醒</button>
            </div>
          </div>
        </div>

        <!-- 应用管控 -->
        <div v-if="activeTab === 'app_control'" key="app_control" class="admin-section">
          <div class="section-toolbar">
            <div class="toolbar-left">
              <h3 class="sub-title"><i class="fa-solid fa-toggle-on" style="margin-right:6px"></i>应用管控</h3>
            </div>
            <div class="toolbar-right">
              <button class="admin-btn" @click="loadAppControl"><i class="fa-solid fa-rotate-right"></i> 刷新</button>
            </div>
          </div>
          <p class="perm-desc">控制每个桌面应用的启用与禁用。禁用的应用不会在用户桌面显示，用户也无法通过路由直接访问。</p>

          <div v-if="appControlLoading" class="admin-empty">加载中...</div>
          <div v-else-if="appControlApps.length === 0" class="admin-empty">暂无应用数据</div>
          <div v-else class="app-control-grid">
            <div v-for="app in appControlApps" :key="app.name" class="app-control-card" :class="{ disabled: !app.enabled }">
              <div class="app-control-icon" :style="{ backgroundColor: app.color }">
                <i :class="app.icon"></i>
              </div>
              <div class="app-control-info">
                <div class="app-control-name">{{ app.label }}</div>
                <div class="app-control-status">
                  <span v-if="app.enabled" class="status-enabled">已启用</span>
                  <span v-else class="status-disabled">已禁用</span>
                  <span v-if="app.name === 'settings'" class="status-locked">（不可禁用）</span>
                </div>
              </div>
              <label class="toggle-switch" @click.stop>
                <input type="checkbox" :checked="app.enabled" :disabled="app.name === 'settings'" @change="toggleAppControl(app)">
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
        </div>

      </transition>
    </div>

    <!-- Create Folder Modal -->
    <transition name="modal-fade">
      <div v-if="showCreateFolder" class="modal-overlay" @click.self="closeCreateFolderModal">
        <div class="modal-card" @click.stop>
          <h3 class="modal-title">新建文件夹</h3>
          <input v-model="newFolderName" class="form-input" placeholder="文件夹名称" @keyup.enter="createFolder" />
          <div class="modal-actions">
            <button class="btn-cancel" @click="closeCreateFolderModal">取消</button>
            <button class="btn-confirm" @click="createFolder">创建</button>
          </div>
        </div>
      </div>
    </transition>

    <!-- Rename Modal -->
    <transition name="modal-fade">
      <div v-if="showRenameModal" class="modal-overlay" @click.self="showRenameModal = false">
        <div class="modal-card" @click.stop>
          <h3 class="modal-title">重命名</h3>
          <input v-model="renameValue" class="form-input" @keyup.enter="confirmRename" />
          <div class="modal-actions">
            <button class="btn-cancel" @click="showRenameModal = false">取消</button>
            <button class="btn-confirm" @click="confirmRename">确定</button>
          </div>
        </div>
      </div>
    </transition>

    <!-- Move Modal -->
    <transition name="modal-fade">
      <div v-if="showMoveModal" class="modal-overlay" @click.self="showMoveModal = false">
        <div class="modal-card" @click.stop>
          <h3 class="modal-title">移动到</h3>
          <div class="move-source-info">
            <span class="move-source-label">移动:</span>
            <span class="move-source-name">{{ moveItem ? moveItem.name : '' }}</span>
          </div>
          <div class="move-browser">
            <div class="move-browser-header">
              <button class="move-browser-back" @click="moveBrowserGoBack" :disabled="moveBrowserPath === '/'">
                <i class="fa-solid fa-arrow-left"></i>
              </button>
              <span class="move-browser-path">{{ moveBrowserPath }}</span>
            </div>
            <div class="move-browser-list scrollbar-thin">
              <div class="move-browser-item" :class="{ active: moveTargetPath === moveBrowserPath }" @click="moveTargetPath = moveBrowserPath">
                <i class="fa-solid fa-folder-open"></i>
                <span>.（当前目录）</span>
              </div>
              <div v-for="folder in moveBrowserFolders" :key="folder.name" class="move-browser-item" @click="moveBrowserNavigate(folder.name)">
                <i class="fa-solid fa-folder"></i>
                <span>{{ folder.name }}</span>
              </div>
              <div v-if="moveBrowserFolders.length === 0" class="move-browser-empty">无子文件夹</div>
            </div>
          </div>
          <div class="move-target-row">
            <span class="move-target-label">目标:</span>
            <input v-model="moveTargetPath" class="form-input" placeholder="目标路径" />
          </div>
          <div class="modal-actions">
            <button class="btn-cancel" @click="showMoveModal = false">取消</button>
            <button class="btn-confirm" @click="confirmMove">确定</button>
          </div>
        </div>
      </div>
    </transition>

    <!-- Copy Modal -->
    <transition name="modal-fade">
      <div v-if="showCopyModal" class="modal-overlay" @click.self="showCopyModal = false">
        <div class="modal-card" @click.stop>
          <h3 class="modal-title">复制到</h3>
          <input v-model="copyTargetPath" class="form-input" placeholder="目标路径" />
          <div class="modal-actions">
            <button class="btn-cancel" @click="showCopyModal = false">取消</button>
            <button class="btn-confirm" @click="confirmCopy">确定</button>
          </div>
        </div>
      </div>
    </transition>

    <!-- Confirm Dialog -->
    <transition name="modal-fade">
      <div v-if="confirmDialog" class="modal-overlay" @click.self="cancelConfirmDialog">
        <div class="modal-card modal-small" @click.stop>
          <h3 class="modal-title">{{ confirmDialog.title }}</h3>
          <p class="modal-desc">{{ confirmDialog.message }}</p>
          <div class="modal-actions">
            <button class="btn-cancel" @click="cancelConfirmDialog">取消</button>
            <button class="btn-confirm btn-confirm-danger" @click="onConfirmDialog">确认</button>
          </div>
        </div>
      </div>
    </transition>

    <!-- Edit Announcement Modal -->
    <transition name="modal-fade">
      <div v-if="showEditAnnouncementModal" class="modal-overlay" @click.self="showEditAnnouncementModal = false">
        <div class="modal-card" @click.stop>
          <h3 class="modal-title">编辑公告</h3>
          <div class="form-group">
            <label class="form-label">类型</label>
            <select v-model="editAnnType" class="form-input">
              <option value="notice">公告</option>
              <option value="homework">作业</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">标题</label>
            <input v-model="editAnnTitle" class="form-input" placeholder="输入标题..." />
          </div>
          <div class="form-group">
            <label class="form-label">内容</label>
            <textarea v-model="editAnnContent" class="form-input" rows="4" placeholder="输入内容..."></textarea>
          </div>
          <div class="modal-actions">
            <button class="btn-cancel" @click="showEditAnnouncementModal = false">取消</button>
            <button class="btn-confirm" @click="saveEditAnnouncement" :disabled="!editAnnTitle.trim() || !editAnnContent.trim()">保存</button>
          </div>
        </div>
      </div>
    </transition>

    <!-- Edit User Detail Modal -->
    <transition name="modal-fade">
      <div v-if="showEditUserModal" class="modal-overlay" @click.self="showEditUserModal = false">
        <div class="modal-card modal-lg" @click.stop>
          <h3 class="modal-title">编辑用户信息</h3>
          <div class="edit-form">
            <div class="form-group">
              <label class="form-label">网名</label>
              <input v-model="editForm.net_name" class="form-input" />
            </div>
            <div class="form-group">
              <label class="form-label">真实姓名</label>
              <input v-model="editForm.real_name" class="form-input" disabled />
            </div>
            <div class="form-group">
              <label class="form-label">性别</label>
              <select v-model="editForm.gender" class="form-input">
                <option value="">未设置</option>
                <option value="男">男</option>
                <option value="女">女</option>
              </select>
            </div>
            <div v-if="isClassAdmin" class="form-group">
              <label class="form-label">管理员权限</label>
              <select v-model="editForm.is_admin" class="form-input">
                <option :value="false">普通用户</option>
                <option :value="true">管理员</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">超能岛浏览器</label>
              <select v-model="editForm.browser_enabled" class="form-input">
                <option :value="false">禁用</option>
                <option :value="true">启用</option>
              </select>
            </div>
          </div>
          <div class="modal-actions">
            <button class="btn-cancel" @click="showEditUserModal = false">取消</button>
            <button class="btn-confirm" @click="saveUserDetail">保存</button>
          </div>
        </div>
      </div>
    </transition>

    <transition name="modal-fade">
      <div v-if="showClearChatModal" class="modal-overlay" @click.self="showClearChatModal = false">
        <div class="modal-card" @click.stop>
          <h3 class="modal-title">清除聊天记录</h3>
          <div class="form-group">
            <label class="form-label">选择聊天室</label>
            <select v-model="clearChatRoom" class="form-input">
              <option value="public">公共聊天室</option>
              <optgroup v-if="groupList.length > 0" label="班级群">
                <option v-for="g in groupList" :key="g.id" :value="String(g.id)">{{ g.name }}</option>
              </optgroup>
            </select>
          </div>
          <p class="modal-desc" style="color: var(--danger-color);">此操作将永久删除选中聊天室的所有消息，不可撤销！</p>
          <div class="modal-actions">
            <button class="btn-cancel" @click="showClearChatModal = false">取消</button>
            <button class="btn-confirm btn-confirm-danger" @click="confirmClearChat" :disabled="clearChatLoading">
              {{ clearChatLoading ? '清除中...' : '确认清除' }}
            </button>
          </div>
        </div>
      </div>
    </transition>

    <transition name="modal-fade">
      <div v-if="showBanModal" class="modal-overlay" @click.self="showBanModal = false">
        <div class="modal-card" @click.stop>
          <h3 class="modal-title">禁用用户 "{{ banForm.userName }}"</h3>
          <div class="form-group">
            <label class="form-label">封禁时长</label>
            <select v-model="banForm.duration" class="form-input">
              <option v-for="d in banDurations" :key="d.value" :value="d.value">{{ d.label }}</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">封禁原因</label>
            <textarea v-model="banForm.reason" class="form-input form-textarea" placeholder="请输入封禁原因..." rows="3"></textarea>
          </div>
          <div class="modal-actions">
            <button class="btn-cancel" @click="showBanModal = false">取消</button>
            <button class="btn-confirm btn-confirm-danger" @click="confirmBan">确认封禁</button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<script>
import api from '@/utils/api';
import AppNavBar from '@/components/AppNavBar.vue';

export default {
  name: 'Admin',
  components: {
    AppNavBar: AppNavBar
  },
  data: function() {
    return {
      activeTab: '',
      tabs: [
  { key: 'users', label: '用户管理' },
  { key: 'permissions', label: '权限管理' },
  { key: 'announcements', label: '公告管理' },
  { key: 'broadcast', label: '广播管理' },
  { key: 'server', label: '服务器状态' },
  { key: 'relay', label: '联动状态' },
  { key: 'resources', label: '资源管理' },
  { key: 'weather', label: '天气提醒' },
  { key: 'app_control', label: '应用管控' },
  { key: 'logs', label: '操作日志' }
],
      loadedTabs: {
        users: false,
        permissions: false,
        announcements: false,
        broadcast: false,
        server: false,
        relay: false,
        resources: false,
        weather: false,
        app_control: false,
        logs: false
      },
      // Users
      users: [],
      allUsersFetched: [],
      usersTotal: 0,
      userSearch: '',
      userClassFilter: '',
      usersLoading: false,
      userRoleFilter: '',
      userStatusFilter: '',
      selectedUsers: [],
      expandedUserId: null,
      expandedUserDetail: null,
      userPageSize: 50,
      userDisplayCount: 50,
      userSearchTimer: null,
      // Broadcast
      broadcastContent: '',
      broadcastPriority: 'normal',
      relayStatus: null,
      relayLoading: false,
      relayRefreshTimer: null,
      syncTriggering: false,
      serverMode: 'single',
      serverModeLoading: false,
      // PM2
      pm2Status: null,
      pm2Loading: false,
      pm2Logs: null,
      pm2LogsLoading: false,
      pm2LogsTab: 'out',
      pm2Timer: null,
      pm2ActionLoading: false,
      syncthingStatus: null,
      tailscaleStatus: null,
      clearChatLoading: false,
      showClearChatModal: false,
      clearChatRoom: 'public',
      groupList: [],
      showBanModal: false,
      banForm: {
        userId: null,
        userName: '',
        duration: 0,
        reason: ''
      },
      banDurations: [
        { label: '永久封禁', value: 0 },
        { label: '10分钟', value: 10 },
        { label: '30分钟', value: 30 },
        { label: '1小时', value: 60 },
        { label: '6小时', value: 360 },
        { label: '12小时', value: 720 },
        { label: '1天', value: 1440 },
        { label: '3天', value: 4320 },
        { label: '7天', value: 10080 },
        { label: '30天', value: 43200 }
      ],
      adminLogs: [],
      logsLoading: false,
      logsPage: 1,
      logsTotal: 0,
      logsLimit: 20,
      // Permissions
      officers: [],
      availableUsers: [],
      showAddOfficerModal: false,
      addOfficerUserId: '',
      addOfficerPermissions: [],
      addOfficerTitle: '',
      editingOfficerId: null,
      editingPermissions: [],
      editingOfficerTitle: '',
      permissionOptions: [
        { key: 'manage_broadcast', label: '广播管理', icon: 'fa-solid fa-bullhorn' },
        { key: 'manage_resources', label: '资源管理', icon: 'fa-solid fa-folder' },
        { key: 'view_logs', label: '查看日志', icon: 'fa-solid fa-file-lines' },
        { key: 'manage_chat', label: '聊天管理', icon: 'fa-solid fa-comments' },
        { key: 'manage_community', label: '社区管理', icon: 'fa-solid fa-people-group' },
        { key: 'manage_users', label: '用户封禁', icon: 'fa-solid fa-user-slash' },
        { key: 'manage_announcements', label: '公告管理', icon: 'fa-solid fa-bullhorn' },
        { key: 'manage_app_control', label: '应用管控', icon: 'fa-solid fa-toggle-on' }
      ],
      // Announcements
      adminAnnouncements: [],
      newAnnTitle: '',
      newAnnContent: '',
      newAnnType: 'notice',
      showEditAnnouncementModal: false,
      editAnnId: null,
      editAnnTitle: '',
      editAnnContent: '',
      editAnnType: 'notice',
      // Monitor
      serverStats: { cpu: 0, memory: 0, disk: 0, online_users: 0, uptime: '-', version: '1.0.0', total_users: 0, storage_used: '0 MB', last_user_login: '-', group_count: 0, _loaded: false },
      monitorTimer: null,
      statsLoading: false,
      // Resources
      resourcePath: '/',
      resourceItems: [],
      resourcesLoading: false,
      resourceSearch: '',
      resourceSearchMode: false,
      resourceSearchResults: [],
      resourceTypeFilter: '',
      resourceSortBy: 'name_asc',
      videoFolderVisible: true,
      musicFolderVisible: true,
      resourceSearchTimer: null,
      showCreateFolder: false,
      newFolderName: '',
      showRenameModal: false,
      renameValue: '',
      renameItem: null,
      showMoveModal: false,
      moveTargetPath: '',
      moveItem: null,
      moveBrowserPath: '/',
      moveBrowserFolders: [],
      showCopyModal: false,
      copyTargetPath: '',
      copyItem: null,
      confirmDialog: null,
      // Edit User Modal
      showEditUserModal: false,
      editForm: {
        id: null,
        user_id: '',
        net_name: '',
        real_name: '',
        gender: '',
        is_admin: false,
        browser_enabled: false,
        userInfo: {}
      },
      // Weather Alert
      weatherSchedules: [],
      newScheduleTime: '',
      weatherCheckResult: null,
      // App Control
      appControlApps: [],
      appControlLoading: false
    };
  },
  computed: {
    isClassAdmin: function() {
      var user = this.$store.state.auth.user;
      return user && user.is_class_admin;
    },
    isAdmin: function() {
      var user = this.$store.state.auth.user;
      return user && (user.is_class_admin || user.is_admin);
    },
    availableClasses: function() {
      // 从用户列表中提取班级号
      var classMap = {};
      this.allUsersFetched.forEach(function(u) {
        if (u.user_id && u.user_id.length === 6) {
          var cc = u.user_id.substring(2, 4);
          if (cc !== '00') classMap[cc] = cc + '班';
        }
      });
      return Object.keys(classMap).sort().map(function(cc) {
        return { id: cc, name: classMap[cc] };
      });
    },
    currentUser: function() {
      return this.$store.state.auth.user || {};
    },
    pm2Process: function() {
      if (!this.pm2Status || !this.pm2Status.processes) return null;
      var list = this.pm2Status.processes;
      for (var i = 0; i < list.length; i++) {
        if (list[i].name === 'classintra-server') return list[i];
      }
      return list.length > 0 ? list[0] : null;
    },
    pm2MemPercent: function() {
      if (!this.pm2Process) return 0;
      var limit = 1024 * 1024 * 1024;
      if (this.pm2Process.memory_limit) {
        var ml = String(this.pm2Process.memory_limit);
        var m = ml.match(/(\d+)/);
        if (m) {
          var val = parseInt(m[1]);
          if (ml.indexOf('G') !== -1) limit = val * 1024 * 1024 * 1024;
          else if (ml.indexOf('M') !== -1) limit = val * 1024 * 1024;
          else if (ml.indexOf('K') !== -1) limit = val * 1024;
          else limit = val;
        }
      }
      return Math.round((this.pm2Process.memory / limit) * 100);
    },
    totalActivePermissions: function() {
      var total = 0;
      for (var i = 0; i < this.officers.length; i++) {
        var perms = this.officers[i].officer_permissions;
        if (Array.isArray(perms)) total += perms.length;
      }
      return total;
    },
    visibleTabs: function() {
      var self = this;
      if (self.isAdmin) return self.tabs;
      return self.tabs.filter(function(tab) {
        if (tab.key === 'users') return self.$store.getters['auth/canManage']('manage_users');
        if (tab.key === 'permissions') return false;
        if (tab.key === 'announcements') return self.$store.getters['auth/canManage']('manage_announcements') || self.$store.getters['auth/canManage']('manage_broadcast');
        if (tab.key === 'broadcast') return self.$store.getters['auth/canManage']('manage_broadcast');
        if (tab.key === 'server') return self.$store.getters['auth/canManage']('view_logs');
        if (tab.key === 'relay') return false;
        if (tab.key === 'resources') return self.$store.getters['auth/canManage']('manage_resources');
        if (tab.key === 'weather') return self.isAdmin;
        if (tab.key === 'app_control') return self.isAdmin || self.$store.getters['auth/canManage']('manage_app_control');
        if (tab.key === 'logs') return self.$store.getters['auth/canManage']('view_logs');
        return false;
      });
    },
    filteredUsers: function() {
      var self = this;
      var list = self.allUsersFetched.length > 0 ? self.allUsersFetched : self.users;
      var result = list;

      // Apply search filter
      var search = self.userSearch.toLowerCase();
      if (search) {
        result = result.filter(function(u) {
          return (u.user_id && u.user_id.toLowerCase().indexOf(search) > -1) ||
                 (u.net_name && u.net_name.toLowerCase().indexOf(search) > -1) ||
                 (u.real_name && u.real_name.toLowerCase().indexOf(search) > -1);
        });
      }

      // Apply role filter
      if (self.userRoleFilter) {
        result = result.filter(function(u) {
          if (self.userRoleFilter === 'admin') return u.is_admin;
          if (self.userRoleFilter === 'officer') return u.role === 'officer' && !u.is_admin;
          if (self.userRoleFilter === 'user') return !u.is_admin && u.role !== 'officer';
          return true;
        });
      }

      // Apply status filter
      if (self.userStatusFilter) {
        result = result.filter(function(u) {
          return u.status === self.userStatusFilter;
        });
      }

      return result;
    },
    displayedUsers: function() {
      return this.filteredUsers.slice(0, this.userDisplayCount);
    },
    isAllSelected: function() {
      var self = this;
      if (self.filteredUsers.length === 0) return false;
      return self.selectedUsers.length === self.filteredUsers.length;
    },
    resourceBreadcrumbs: function() {
      var parts = this.resourcePath.split('/').filter(function(p) { return p; });
      var crumbs = [{ name: '根目录', path: '/' }];
      var path = '';
      for (var i = 0; i < parts.length; i++) {
        path += '/' + parts[i];
        crumbs.push({ name: parts[i], path: path });
      }
      return crumbs;
    },
    filteredResourceItems: function() {
      var self = this;
      var items = self.resourceItems.slice();

      // Type filter
      if (self.resourceTypeFilter) {
        items = items.filter(function(item) {
          if (item.is_dir) return false;
          return item.fileType === self.resourceTypeFilter;
        });
      }

      // Sort
      items.sort(function(a, b) {
        switch (self.resourceSortBy) {
          case 'name_asc':
            return (a.name || '').localeCompare(b.name || '');
          case 'name_desc':
            return (b.name || '').localeCompare(a.name || '');
          case 'size_desc':
            return (b.size || 0) - (a.size || 0);
          case 'size_asc':
            return (a.size || 0) - (b.size || 0);
          case 'date_desc':
            return new Date(b.modified || 0) - new Date(a.modified || 0);
          case 'date_asc':
            return new Date(a.modified || 0) - new Date(b.modified || 0);
          default:
            return 0;
        }
      });

      return items;
    },
    totalResourceSize: function() {
      var total = 0;
      for (var i = 0; i < this.resourceItems.length; i++) {
        var item = this.resourceItems[i];
        if (!item.is_dir && item.size) {
          total += item.size;
        }
      }
      return this.formatSize(total);
    },
    mergedAdminLogs: function() {
      var logs = this.adminLogs;
      if (!logs || logs.length === 0) return [];
      var result = [];
      var i = 0;
      while (i < logs.length) {
        var current = logs[i];
        var merged = {
          id: current.id,
          action: current.action,
          admin_id: current.admin_id,
          target: current.target || '',
          detail: current.detail || '',
          created_at: current.created_at,
          earliestTime: current.created_at,
          latestTime: current.created_at,
          count: 1,
          merged: false,
          targets: current.target ? [current.target] : [],
          details: current.detail ? [current.detail] : []
        };
        var j = i + 1;
        while (j < logs.length && logs[j].action === current.action && logs[j].admin_id === current.admin_id) {
          var next = logs[j];
          merged.count++;
          merged.merged = true;
          merged.latestTime = next.created_at;
          if (next.target && merged.targets.indexOf(next.target) === -1) {
            merged.targets.push(next.target);
          }
          if (next.detail && merged.details.indexOf(next.detail) === -1) {
            merged.details.push(next.detail);
          }
          j++;
        }
        if (merged.count > 1) {
          merged.target = merged.targets.join(', ');
          merged.detail = merged.details.join(', ');
        }
        result.push(merged);
        i = j;
      }
      return result;
    }
  },
  watch: {
    activeTab: function(newVal, oldVal) {
      this.loadTabData(newVal);
      if (newVal === 'relay') {
        this.loadRelayStatus();
        this.startRelayRefreshTimer();
      } else {
        this.stopRelayRefreshTimer();
      }
    }
  },
  mounted: function() {
    this.loadServerStats();
    if (!this.activeTab && this.visibleTabs.length > 0) {
      this.activeTab = this.visibleTabs[0].key;
    }
    if (this.activeTab) {
      this.loadTabData(this.activeTab);
    }
    this.startMonitorTimer();
    this.startPM2Timer();
  },
  beforeDestroy: function() {
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
    }
    if (this.pm2Timer) {
      clearInterval(this.pm2Timer);
    }
    this.stopRelayRefreshTimer();
    if (this.userSearchTimer) {
      clearTimeout(this.userSearchTimer);
    }
    if (this.resourceSearchTimer) {
      clearTimeout(this.resourceSearchTimer);
    }
    if (this.communitySearchTimer) {
      clearTimeout(this.communitySearchTimer);
    }
  },
  methods: {
    // ======== Tab Management ========
    switchTab: function(tabKey) {
      this.activeTab = tabKey;
    },
    loadTabData: function(tabKey) {
      // 权限管理标签页每次切换都重新加载，确保权限数据最新
      if (tabKey !== 'permissions' && this.loadedTabs[tabKey]) return;
      this.loadedTabs[tabKey] = true;

      switch (tabKey) {
        case 'users':
          this.loadUsers();
          break;
        case 'permissions':
          this.loadOfficers();
          break;
        case 'announcements':
          this.loadAdminAnnouncements();
          break;
        case 'broadcast':
          break;
        case 'server':
          this.loadServerStats();
          break;
        case 'relay':
          this.loadRelayStatus();
          break;
        case 'resources':
          this.loadResources();
          break;
        case 'weather':
          this.loadWeatherSchedules();
          break;
        case 'app_control':
          this.loadAppControl();
          break;
        case 'logs':
          this.loadAdminLogs();
          break;
      }
    },

    // ======== Debounce Helper ========
    debounce: function(fn, delay) {
      var timer = null;
      return function() {
        var context = this;
        var args = arguments;
        if (timer) clearTimeout(timer);
        timer = setTimeout(function() {
          fn.apply(context, args);
        }, delay);
      };
    },

    // ======== Users ========
    loadUsers: function() {
      var self = this;
      self.usersLoading = true;
      var params = { limit: 9999 };
      if (self.userClassFilter) params.class = self.userClassFilter;
      api.get('/admin/users', { params: params }).then(function(response) {
        var data = response.data.data || {};
        var users = data.users || (Array.isArray(data) ? data : []);
        var total = data.total || users.length;
        self.users = users;
        self.allUsersFetched = users;
        self.usersTotal = total;
        self.selectedUsers = [];
        self.userDisplayCount = self.userPageSize;
      }).catch(function(err) {
        console.error('加载用户列表失败:', err);
        self.$store.commit('toast/SHOW_TOAST', { message: '加载用户列表失败', type: 'error' });
      }).finally(function() {
        self.usersLoading = false;
      });
    },
    onUserSearchInput: function() {
      var self = this;
      if (self.userSearchTimer) clearTimeout(self.userSearchTimer);
      self.userSearchTimer = setTimeout(function() {
        // Reset display count when search changes
        self.userDisplayCount = self.userPageSize;
      }, 300);
    },
    applyUserFilters: function() {
      this.userDisplayCount = this.userPageSize;
    },
    toggleSelectAll: function() {
      if (this.isAllSelected) {
        this.selectedUsers = [];
      } else {
        var ids = [];
        for (var i = 0; i < this.filteredUsers.length; i++) {
          ids.push(this.filteredUsers[i].user_id);
        }
        this.selectedUsers = ids;
      }
    },
    loadMoreUsers: function() {
      this.userDisplayCount += this.userPageSize;
    },
    toggleUser: function(user) {
      var self = this;
      if (user.status === 'disabled') {
        self.confirmDialog = {
          title: '启用用户',
          message: '确定要启用用户 "' + user.net_name + '" 吗？',
          onConfirm: function() {
            api.patch('/admin/users/' + user.id + '/status', { status: 'active' }).then(function() {
              user.status = 'active';
              user.ban_expires_at = null;
              user.ban_reason = null;
              self.$store.commit('toast/SHOW_TOAST', { message: '用户已启用', type: 'success' });
            }).catch(function(err) {
              console.error('启用用户失败:', err);
              self.$store.commit('toast/SHOW_TOAST', { message: '启用用户失败', type: 'error' });
            });
          }
        };
      } else {
        self.banForm = {
          userId: user.id,
          userName: user.net_name,
          duration: 0,
          reason: ''
        };
        self.showBanModal = true;
      }
    },
    confirmBan: function() {
      var self = this;
      api.patch('/admin/users/' + self.banForm.userId + '/status', {
        status: 'disabled',
        duration: self.banForm.duration,
        reason: self.banForm.reason.trim()
      }).then(function() {
        var user = self.users.find(function(u) { return u.id === self.banForm.userId; });
        if (user) {
          user.status = 'disabled';
          user.ban_reason = self.banForm.reason.trim();
        }
        var allUser = self.allUsersFetched.find(function(u) { return u.id === self.banForm.userId; });
        if (allUser) {
          allUser.status = 'disabled';
          allUser.ban_reason = self.banForm.reason.trim();
        }
        self.showBanModal = false;
        self.$store.commit('toast/SHOW_TOAST', { message: '用户已禁用', type: 'success' });
      }).catch(function(err) {
        console.error('禁用用户失败:', err);
        self.$store.commit('toast/SHOW_TOAST', { message: '禁用用户失败', type: 'error' });
      });
    },
    deleteUser: function(user) {
      var self = this;
      self.confirmDialog = {
        title: '删除用户',
        message: '确定删除用户 "' + user.net_name + '"？此操作不可撤销。',
        onConfirm: function() {
          api.delete('/admin/users/' + user.id).then(function() {
            var idx = self.users.findIndex(function(u) { return u.id === user.id; });
            if (idx > -1) self.users.splice(idx, 1);
            var allIdx = self.allUsersFetched.findIndex(function(u) { return u.id === user.id; });
            if (allIdx > -1) self.allUsersFetched.splice(allIdx, 1);
            // Remove from selection
            var selIdx = self.selectedUsers.indexOf(user.user_id);
            if (selIdx > -1) self.selectedUsers.splice(selIdx, 1);
            self.$store.commit('toast/SHOW_TOAST', { message: '用户已删除', type: 'success' });
          }).catch(function(err) {
            console.error('删除用户失败:', err);
            self.$store.commit('toast/SHOW_TOAST', { message: '删除用户失败', type: 'error' });
          });
        }
      };
    },
    batchDeleteUsers: function() {
      var self = this;
      var count = self.selectedUsers.length;
      self.confirmDialog = {
        title: '批量删除用户',
        message: '确定删除选中的 ' + count + ' 个用户？此操作不可撤销。',
        onConfirm: function() {
          var promises = [];
          for (var i = 0; i < self.selectedUsers.length; i++) {
            var userId = self.selectedUsers[i];
            var user = self.users.find(function(u) { return u.user_id === userId; });
            if (user && user.id) {
              promises.push(api.delete('/admin/users/' + user.id));
            }
          }
          Promise.all(promises).then(function() {
            self.$store.commit('toast/SHOW_TOAST', { message: '成功删除 ' + count + ' 个用户', type: 'success' });
            self.selectedUsers = [];
            self.loadUsers();
          }).catch(function(err) {
            console.error('批量删除失败:', err);
            self.$store.commit('toast/SHOW_TOAST', { message: '批量删除部分失败，请重试', type: 'error' });
          });
        }
      };
    },
    batchBanUsers: function() {
      var self = this;
      var count = self.selectedUsers.length;
      self.banDuration = 0;
      self.banReason = '';
      self.confirmDialog = {
        title: '批量封禁用户',
        message: '确定封禁选中的 ' + count + ' 个用户？',
        onConfirm: function() {
          var promises = [];
          for (var i = 0; i < self.selectedUsers.length; i++) {
            var userId = self.selectedUsers[i];
            var user = self.users.find(function(u) { return u.user_id === userId; });
            if (user && user.id && user.status !== 'disabled') {
              promises.push(api.patch('/admin/users/' + user.id + '/status', {
                status: 'disabled',
                reason: self.banReason || '管理员批量封禁',
                duration: self.banDuration || 0
              }));
            }
          }
          if (promises.length === 0) {
            self.$store.commit('toast/SHOW_TOAST', { message: '选中的用户均已被封禁', type: 'warning' });
            return;
          }
          Promise.all(promises).then(function() {
            self.$store.commit('toast/SHOW_TOAST', { message: '成功封禁 ' + promises.length + ' 个用户', type: 'success' });
            self.selectedUsers = [];
            self.loadUsers();
          }).catch(function(err) {
            console.error('批量封禁失败:', err);
            self.$store.commit('toast/SHOW_TOAST', { message: '批量封禁部分失败，请重试', type: 'error' });
          });
        }
      };
    },
    batchUnbanUsers: function() {
      var self = this;
      var count = self.selectedUsers.length;
      self.confirmDialog = {
        title: '批量解禁用户',
        message: '确定解禁选中的 ' + count + ' 个用户？',
        onConfirm: function() {
          var promises = [];
          for (var i = 0; i < self.selectedUsers.length; i++) {
            var userId = self.selectedUsers[i];
            var user = self.users.find(function(u) { return u.user_id === userId; });
            if (user && user.id && user.status === 'disabled') {
              promises.push(api.patch('/admin/users/' + user.id + '/status', {
                status: 'active'
              }));
            }
          }
          if (promises.length === 0) {
            self.$store.commit('toast/SHOW_TOAST', { message: '选中的用户均未被封禁', type: 'warning' });
            return;
          }
          Promise.all(promises).then(function() {
            self.$store.commit('toast/SHOW_TOAST', { message: '成功解禁 ' + promises.length + ' 个用户', type: 'success' });
            self.selectedUsers = [];
            self.loadUsers();
          }).catch(function(err) {
            console.error('批量解禁失败:', err);
            self.$store.commit('toast/SHOW_TOAST', { message: '批量解禁部分失败，请重试', type: 'error' });
          });
        }
      };
    },
    toggleUserDetail: function(user) {
      if (this.expandedUserId === user.user_id) {
        this.expandedUserId = null;
        this.expandedUserDetail = null;
      } else {
        this.expandedUserId = user.user_id;
        this.expandedUserDetail = user;
      }
    },
    loadOfficers: function() {
      var self = this;
      api.get('/admin/officers').then(function(response) {
        self.officers = response.data.data || [];
      }).catch(function() {
        self.officers = [];
      });
      api.get('/admin/available-officers').then(function(response) {
        self.availableUsers = response.data.data || [];
      }).catch(function() {
        self.availableUsers = [];
      });
    },
    openAddOfficerModal: function() {
      this.addOfficerUserId = '';
      this.addOfficerPermissions = [];
      this.addOfficerTitle = '';
      this.showAddOfficerModal = true;
    },
    confirmAddOfficer: function() {
      var self = this;
      if (!self.addOfficerUserId) {
        self.$store.commit('toast/SHOW_TOAST', { message: '请选择用户', type: 'warning' });
        return;
      }
      api.post('/admin/officers', {
        user_id: self.addOfficerUserId,
        permissions: self.addOfficerPermissions,
        title: self.addOfficerTitle
      }).then(function() {
        self.showAddOfficerModal = false;
        self.$store.commit('toast/SHOW_TOAST', { message: '班干添加成功', type: 'success' });
        self.loadOfficers();
      }).catch(function(err) {
        var msg = '添加失败';
        if (err.response && err.response.data && err.response.data.message) msg = err.response.data.message;
        self.$store.commit('toast/SHOW_TOAST', { message: msg, type: 'error' });
      });
    },
    removeOfficer: function(userOrId) {
      var self = this;
      var userId = typeof userOrId === 'string' ? userOrId : userOrId.user_id;
      var userObj = typeof userOrId === 'object' ? userOrId : null;
      var confirmFn = function() {
        api.delete('/admin/officers/' + userId).then(function() {
          self.$store.commit('toast/SHOW_TOAST', { message: '班干已移除', type: 'success' });
          self.loadOfficers();
          // 同步更新展开详情和用户列表中的状态
          if (self.expandedUserDetail && self.expandedUserDetail.user_id === userId) {
            self.$set(self.expandedUserDetail, 'role', 'user');
            self.$set(self.expandedUserDetail, 'officer_title', '');
            self.$set(self.expandedUserDetail, 'officer_permissions', '');
          }
          if (userObj) {
            userObj.role = 'user';
            userObj.officer_title = '';
            userObj.officer_permissions = '';
          }
          // 同步用户列表
          for (var i = 0; i < self.users.length; i++) {
            if (self.users[i].user_id === userId) {
              self.$set(self.users[i], 'role', 'user');
              self.$set(self.users[i], 'officer_title', '');
              break;
            }
          }
        }).catch(function() {
          self.$store.commit('toast/SHOW_TOAST', { message: '移除失败', type: 'error' });
        });
      };
      if (userObj) {
        // 从用户详情直接操作时不需要确认对话框
        confirmFn();
      } else {
        self.confirmDialog = {
          title: '移除班干',
          message: '确定移除该班干？其权限将被清除。',
          onConfirm: confirmFn
        };
      }
    },
    startEditPermissions: function(officer) {
      this.editingOfficerId = officer.user_id;
      this.editingPermissions = (officer.officer_permissions || []).slice();
      this.editingOfficerTitle = officer.officer_title || '';
    },
    savePermissions: function() {
      var self = this;
      api.patch('/admin/officers/' + self.editingOfficerId + '/permissions', {
        permissions: self.editingPermissions,
        title: self.editingOfficerTitle
      }).then(function() {
        self.editingOfficerId = null;
        self.editingOfficerTitle = '';
        self.$store.commit('toast/SHOW_TOAST', { message: '权限更新成功', type: 'success' });
        self.loadOfficers();
      }).catch(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '权限更新失败', type: 'error' });
      });
    },
    cancelEditPermissions: function() {
      this.editingOfficerId = null;
      this.editingPermissions = [];
      this.editingOfficerTitle = '';
    },
    loadAdminAnnouncements: function() {
      var self = this;
      api.get('/admin/announcements').then(function(response) {
        self.adminAnnouncements = response.data.data || [];
      }).catch(function() {
        self.adminAnnouncements = [];
      });
    },
    createAnnouncement: function() {
      var self = this;
      if (!self.newAnnTitle.trim() || !self.newAnnContent.trim()) {
        self.$store.commit('toast/SHOW_TOAST', { message: '标题和内容不能为空', type: 'warning' });
        return;
      }
      api.post('/admin/announcements', {
        title: self.newAnnTitle.trim(),
        content: self.newAnnContent.trim(),
        type: self.newAnnType
      }).then(function() {
        self.newAnnTitle = '';
        self.newAnnContent = '';
        self.newAnnType = 'notice';
        self.$store.commit('toast/SHOW_TOAST', { message: '公告发布成功', type: 'success' });
        self.loadAdminAnnouncements();
      }).catch(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '发布失败', type: 'error' });
      });
    },
    togglePinAnnouncement: function(id, pinned) {
      var self = this;
      api.patch('/admin/announcements/' + id + '/pin', { pinned: !pinned }).then(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: pinned ? '已取消置顶' : '已置顶', type: 'success' });
        self.loadAdminAnnouncements();
      }).catch(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '操作失败', type: 'error' });
      });
    },
    deleteAnnouncement: function(id) {
      var self = this;
      self.confirmDialog = {
        title: '删除公告',
        message: '确定删除此公告？',
        onConfirm: function() {
          api.delete('/admin/announcements/' + id).then(function() {
            self.$store.commit('toast/SHOW_TOAST', { message: '公告已删除', type: 'success' });
            self.loadAdminAnnouncements();
          }).catch(function() {
            self.$store.commit('toast/SHOW_TOAST', { message: '删除失败', type: 'error' });
          });
        }
      };
    },
    startEditAnnouncement: function(item) {
      this.editAnnId = item.id;
      this.editAnnTitle = item.title;
      this.editAnnContent = item.content;
      this.editAnnType = item.type || 'notice';
      this.showEditAnnouncementModal = true;
    },
    saveEditAnnouncement: function() {
      var self = this;
      if (!self.editAnnTitle.trim() || !self.editAnnContent.trim()) {
        self.$store.commit('toast/SHOW_TOAST', { message: '标题和内容不能为空', type: 'warning' });
        return;
      }
      api.put('/admin/announcements/' + self.editAnnId, {
        title: self.editAnnTitle.trim(),
        content: self.editAnnContent.trim(),
        type: self.editAnnType
      }).then(function() {
        self.showEditAnnouncementModal = false;
        self.$store.commit('toast/SHOW_TOAST', { message: '公告已更新', type: 'success' });
        self.loadAdminAnnouncements();
      }).catch(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '更新失败', type: 'error' });
      });
    },
    togglePermission: function(permKey, targetArray) {
      var self = this;
      var arr = targetArray === 'edit' ? self.editingPermissions : self.addOfficerPermissions;
      var idx = arr.indexOf(permKey);
      if (idx > -1) {
        arr.splice(idx, 1);
      } else {
        arr.push(permKey);
      }
    },
    editUserDetail: function(user) {
      this.editForm = {
        id: user.id,
        user_id: user.user_id,
        net_name: user.net_name || '',
        real_name: user.real_name || '',
        gender: user.gender || '',
        is_admin: user.is_admin ? true : false,
        browser_enabled: !!(user.info && user.info.browser_enabled),
        userInfo: user.info || {}
      };
      this.showEditUserModal = true;
    },
    saveUserDetail: function() {
      var self = this;
      // Basic validation
      if (!self.editForm.net_name.trim()) {
        self.$store.commit('toast/SHOW_TOAST', { message: '网名不能为空', type: 'warning' });
        return;
      }
      var payload = {
        net_name: self.editForm.net_name.trim(),
        real_name: self.editForm.real_name.trim(),
        gender: self.editForm.gender,
        info: Object.assign({}, self.editForm.userInfo || {}, { browser_enabled: self.editForm.browser_enabled })
      };
      if (self.isClassAdmin) {
        payload.is_admin = self.editForm.is_admin;
      }
      api.patch('/admin/users/' + self.editForm.id, payload).then(function() {
        var user = self.users.find(function(u) { return u.user_id === self.editForm.user_id; });
        if (user) {
          user.net_name = self.editForm.net_name;
          user.real_name = self.editForm.real_name;
          user.gender = self.editForm.gender;
          user.is_admin = self.editForm.is_admin;
        }
        var allUser = self.allUsersFetched.find(function(u) { return u.user_id === self.editForm.user_id; });
        if (allUser) {
          allUser.net_name = self.editForm.net_name;
          allUser.real_name = self.editForm.real_name;
          allUser.gender = self.editForm.gender;
          allUser.is_admin = self.editForm.is_admin;
        }
        self.showEditUserModal = false;
        self.$store.commit('toast/SHOW_TOAST', { message: '用户信息已更新', type: 'success' });
      }).catch(function(err) {
        console.error('保存用户信息失败:', err);
        self.$store.commit('toast/SHOW_TOAST', { message: '保存用户信息失败', type: 'error' });
      });
    },

    parseOfficerPermissions: function(permsStr) {
      var permLabels = {
        manage_broadcast: '广播管理',
        manage_resources: '资源管理',
        view_logs: '查看日志',
        manage_chat: '聊天管理',
        manage_community: '社区管理',
        manage_users: '用户封禁',
        manage_announcements: '公告管理',
        manage_app_control: '应用管控'
      };
      try {
        var perms = JSON.parse(permsStr || '[]');
        return perms.map(function(p) { return permLabels[p] || p; });
      } catch (e) { return []; }
    },

    setAsOfficer: function(user) {
      var self = this;
      if (!self.isAdmin) return;
      api.post('/admin/officers', {
        user_id: user.user_id,
        title: '班干',
        permissions: []
      }).then(function(response) {
        if (response.data.code === 200) {
          self.$store.commit('toast/SHOW_TOAST', { message: '已设为班干', type: 'success' });
          user.role = 'officer';
          user.officer_title = '班干';
          user.officer_permissions = '[]';
          if (self.expandedUserDetail && self.expandedUserDetail.user_id === user.user_id) {
            self.$set(self.expandedUserDetail, 'role', 'officer');
            self.$set(self.expandedUserDetail, 'officer_title', '班干');
          }
        }
      }).catch(function(err) {
        self.$store.commit('toast/SHOW_TOAST', { message: '设置班干失败', type: 'error' });
      });
    },

    // ======== Broadcast ========
    sendBroadcast: function() {
      var self = this;
      if (!self.broadcastContent.trim()) return;
      api.post('/admin/broadcasts', { content: self.broadcastContent.trim(), priority: self.broadcastPriority }).then(function() {
        self.broadcastContent = '';
        self.$store.commit('toast/SHOW_TOAST', { message: '广播发送成功', type: 'success' });
      }).catch(function(err) {
        console.error('广播发送失败:', err);
        self.$store.commit('toast/SHOW_TOAST', { message: '广播发送失败', type: 'error' });
      });
    },

    // ======== Monitor ========
    loadServerStats: function() {
      var self = this;
      if (!self.serverStats._loaded) {
        self.statsLoading = true;
      }
      api.get('/admin/server-stats').then(function(response) {
        var data = response.data.data || {};
        var stats = {
          cpu: (data.cpu && data.cpu.usage) || 0,
          memory: (data.memory && data.memory.usagePercent) || 0,
          disk: (data.disk && data.disk.usagePercent) || 0,
          online_users: (data.connections && data.connections.websocket) || 0,
          total_users: data.total_users || 0,
          storage_used: data.storage_used || '0 MB',
          last_user_login: data.last_user_login || '-',
          group_count: data.group_count || 0,
          uptime: self.formatUptime(data.uptime),
          version: data.version || '1.0.0',
          _loaded: true
        };
        self.serverStats = stats;
      }).catch(function(err) {
        console.error('加载服务器状态失败:', err);
      }).finally(function() {
        self.statsLoading = false;
      });
    },
    startMonitorTimer: function() {
      var self = this;
      self.monitorTimer = setInterval(function() {
        self.loadServerStats();
      }, 5000);
    },
    loadPM2Status: function() {
      var self = this;
      self.pm2Loading = true;
      api.get('/admin/pm2/status').then(function(response) {
        self.pm2Status = response.data.data || null;
      }).catch(function(err) {
        console.error('PM2 status failed:', err);
        self.pm2Status = null;
      }).finally(function() {
        self.pm2Loading = false;
      });
    },
    startPM2Timer: function() {
      var self = this;
      self.pm2Timer = setInterval(function() {
        if (self.activeTab === 'server') self.loadPM2Status();
      }, 10000);
    },
    pm2Action: function(action) {
      var self = this;
      self.pm2ActionLoading = true;
      api.post('/admin/pm2/' + action).then(function(response) {
        self.$toast && self.$toast.success(response.data.message || action + ' OK');
        setTimeout(function() { self.loadPM2Status(); }, 2000);
      }).catch(function(err) {
        self.$toast && self.$toast.error((err.response && err.response.data && err.response.data.message) || action + ' failed');
      }).finally(function() {
        self.pm2ActionLoading = false;
      });
    },
    loadPM2Logs: function() {
      var self = this;
      self.pm2LogsLoading = true;
      api.get('/admin/pm2/logs?lines=200').then(function(response) {
        self.pm2Logs = response.data.data || null;
      }).catch(function(err) {
        console.error('PM2 logs failed:', err);
      }).finally(function() {
        self.pm2LogsLoading = false;
      });
    },
    formatBytes: function(bytes) {
      if (!bytes || bytes === 0) return '0 B';
      var units = ['B', 'KB', 'MB', 'GB'];
      var i = 0;
      var val = bytes;
      while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
      return val.toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
    },
    formatPM2Uptime: function(ts) {
      if (!ts) return '-';
      var diff = Date.now() - ts;
      var secs = Math.floor(diff / 1000);
      var days = Math.floor(secs / 86400);
      var hours = Math.floor((secs % 86400) / 3600);
      var mins = Math.floor((secs % 3600) / 60);
      var parts = [];
      if (days > 0) parts.push(days + 'd');
      if (hours > 0) parts.push(hours + 'h');
      parts.push(mins + 'm');
      return parts.join(' ');
    },
    loadRelayStatus: function() {
      var self = this;
      self.relayLoading = true;
      api.get('/admin/relay-status').then(function(response) {
        self.relayStatus = response.data.data || null;
        if (response.data.data && response.data.data.mode) {
          self.serverMode = response.data.data.mode;
        }
      }).catch(function() {
        self.relayStatus = null;
      }).finally(function() {
        self.relayLoading = false;
      });
      self.loadSyncthingStatus();
      self.loadTailscaleStatus();
    },
    loadSyncthingStatus: function() {
      var self = this;
      api.get('/admin/syncthing-status').then(function(response) {
        self.syncthingStatus = response.data.data || null;
      }).catch(function() {
        self.syncthingStatus = null;
      });
    },
    loadTailscaleStatus: function() {
      var self = this;
      api.get('/admin/tailscale-status').then(function(response) {
        self.tailscaleStatus = response.data.data || null;
      }).catch(function() {
        self.tailscaleStatus = null;
      });
    },
    startRelayRefreshTimer: function() {
      var self = this;
      self.relayRefreshTimer = setInterval(function() {
        self.loadRelayStatus();
      }, 15000);
    },
    stopRelayRefreshTimer: function() {
      if (this.relayRefreshTimer) {
        clearInterval(this.relayRefreshTimer);
        this.relayRefreshTimer = null;
      }
    },
    switchServerMode: function(mode) {
      var self = this;
      if (self.serverMode === mode || self.serverModeLoading) return;
      self.serverModeLoading = true;
      api.post('/admin/server-mode', { mode: mode }).then(function(res) {
        self.serverMode = mode;
        self.$store.commit('toast/SHOW_TOAST', { message: res.data.message || '模式切换成功', type: 'success' });
        self.loadRelayStatus();
      }).catch(function(err) {
        self.$store.commit('toast/SHOW_TOAST', { message: '切换模式失败：' + (err.response && err.response.data && err.response.data.message || '未知错误'), type: 'error' });
      }).finally(function() {
        self.serverModeLoading = false;
      });
    },
    disconnectRelay: function() {
      var self = this;
      api.post('/admin/relay-disconnect').then(function(res) {
        self.$store.commit('toast/SHOW_TOAST', { message: res.data.message || '已断开', type: 'success' });
        self.loadRelayStatus();
      }).catch(function(err) {
        self.$store.commit('toast/SHOW_TOAST', { message: '断开失败：' + (err.response && err.response.data && err.response.data.message || '未知错误'), type: 'error' });
      });
    },
    connectRelay: function() {
      var self = this;
      api.post('/admin/relay-connect').then(function(res) {
        self.$store.commit('toast/SHOW_TOAST', { message: res.data.message || '正在连接...', type: 'success' });
        setTimeout(function() { self.loadRelayStatus(); }, 2000);
      }).catch(function(err) {
        self.$store.commit('toast/SHOW_TOAST', { message: '连接失败：' + (err.response && err.response.data && err.response.data.message || '未知错误'), type: 'error' });
      });
    },
    triggerSync: function() {
      var self = this;
      self.syncTriggering = true;
      api.post('/admin/trigger-sync').then(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '同步请求已发送', type: 'success' });
        setTimeout(function() { self.loadRelayStatus(); }, 3000);
      }).catch(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '同步请求失败', type: 'error' });
      }).finally(function() {
        self.syncTriggering = false;
      });
    },
    checkConsistency: function() {
      var self = this;
      api.get('/admin/consistency-check').then(function(response) {
        var data = response.data.data;
        var lines = [];
        lines.push('用户: ' + data.user_count);
        lines.push('帖子: ' + data.post_count);
        lines.push('评论: ' + data.comment_count);
        lines.push('聊天: ' + data.chat_count);
        lines.push('群组: ' + data.group_count);
        lines.push('墓碑: ' + data.tombstone_count);
        self.$store.commit('toast/SHOW_TOAST', { message: '一致性检查完成，请查看控制台', type: 'success' });
        console.log('[Consistency Check]', data);
      }).catch(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '一致性检查失败', type: 'error' });
      });
    },
    isSyncEmpty: function(result) {
      if (!result) return true;
      return result.chat === 0 && result.pm === 0 && result.gm === 0 &&
        result.posts === 0 && result.comments === 0 && result.likes === 0 &&
        result.reactions === 0 && result.bookmarks === 0 && result.exp_logs === 0 &&
        result.broadcasts === 0 && result.users === 0 && result.groups === 0;
    },
    getBarClass: function(value) {
      if (value >= 90) return 'critical';
      if (value >= 70) return 'warning';
      return 'normal';
    },

    // ======== Resources ========
    loadResources: function() {
      var self = this;
      self.resourcesLoading = true;
      self.resourceSearchMode = false;
      api.get('/resources', { params: { path: self.resourcePath === '/' ? '' : self.resourcePath } }).then(function(response) {
        var data = response.data.data || {};
        self.resourceItems = data.files || [];
      }).catch(function(err) {
        console.error('加载资源列表失败:', err);
        self.$store.commit('toast/SHOW_TOAST', { message: '加载资源列表失败', type: 'error' });
      }).finally(function() {
        self.resourcesLoading = false;
      });
      api.get('/admin/resource-settings').then(function(response) {
        var data = response.data.data || {};
        self.videoFolderVisible = data.video_visible !== false;
        self.musicFolderVisible = data.music_visible !== false;
      }).catch(function() {});
    },
    toggleVideoFolderVisible: function() {
      var self = this;
      api.post('/admin/resource-settings', { video_visible: self.videoFolderVisible }).then(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: self.videoFolderVisible ? '视频文件夹已设为可见' : '视频文件夹已设为隐藏', type: 'success' });
      }).catch(function() {
        self.videoFolderVisible = !self.videoFolderVisible;
        self.$store.commit('toast/SHOW_TOAST', { message: '设置保存失败', type: 'error' });
      });
    },
    toggleMusicFolderVisible: function() {
      var self = this;
      api.post('/admin/resource-settings', { music_visible: self.musicFolderVisible }).then(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: self.musicFolderVisible ? '音乐文件夹已设为可见' : '音乐文件夹已设为隐藏', type: 'success' });
      }).catch(function() {
        self.musicFolderVisible = !self.musicFolderVisible;
        self.$store.commit('toast/SHOW_TOAST', { message: '设置保存失败', type: 'error' });
      });
    },
    onResourceSearchInput: function() {
      var self = this;
      if (self.resourceSearchTimer) clearTimeout(self.resourceSearchTimer);
      self.resourceSearchTimer = setTimeout(function() {
        if (self.resourceSearch.trim()) {
          self.searchResources();
        } else {
          self.resourceSearchMode = false;
        }
      }, 300);
    },
    searchResources: function() {
      var self = this;
      if (!self.resourceSearch.trim()) {
        self.resourceSearchMode = false;
        return;
      }
      self.resourcesLoading = true;
      api.get('/resources/search', { params: { q: self.resourceSearch.trim() } }).then(function(response) {
        var data = response.data.data || {};
        self.resourceSearchResults = data.results || [];
        self.resourceSearchMode = true;
      }).catch(function(err) {
        console.error('搜索失败:', err);
        self.$store.commit('toast/SHOW_TOAST', { message: '搜索失败', type: 'error' });
      }).finally(function() {
        self.resourcesLoading = false;
      });
    },
    buildResourcePath: function(name) {
      var base = this.resourcePath === '/' ? '' : this.resourcePath;
      return (base ? base + '/' : '') + name;
    },
    navigateResource: function(path) {
      this.resourcePath = path || '/';
      this.resourceSearchMode = false;
      this.resourceSearch = '';
      this.resourceTypeFilter = '';
      this.loadResources();
    },
    goResourceBack: function() {
      if (this.resourcePath === '/' || !this.resourcePath) return;
      var parts = this.resourcePath.split('/');
      parts.pop();
      this.resourcePath = parts.join('/') || '/';
      this.loadResources();
    },
    getResourceIcon: function(item) {
      if (item.is_dir) return 'fa-solid fa-folder';
      var typeMap = {
        video: 'fa-solid fa-film',
        image: 'fa-solid fa-image',
        audio: 'fa-solid fa-music',
        document: 'fa-solid fa-file-pdf',
        html: 'fa-solid fa-file-code',
        text: 'fa-solid fa-file-code',
        archive: 'fa-solid fa-file-zipper'
      };
      return typeMap[item.fileType] || 'fa-solid fa-file';
    },
    downloadResource: function(item) {
      var filePath = this.buildResourcePath(item.name);
      var tokenParam = this.$store.state.auth.token ? '&token=' + encodeURIComponent(this.$store.state.auth.token) : '';
      window.location.href = '/api/resources/download?path=' + encodeURIComponent(filePath) + tokenParam;
    },
    closeCreateFolderModal: function() {
      this.showCreateFolder = false;
      this.newFolderName = '';
    },
    createFolder: function() {
      var self = this;
      if (!self.newFolderName.trim()) {
        self.$store.commit('toast/SHOW_TOAST', { message: '请输入文件夹名称', type: 'warning' });
        return;
      }
      api.post('/resources/create-folder', {
        parent_path: self.resourcePath === '/' ? '' : self.resourcePath,
        folder_name: self.newFolderName.trim()
      }).then(function() {
        self.closeCreateFolderModal();
        self.loadResources();
        self.$store.commit('toast/SHOW_TOAST', { message: '文件夹创建成功', type: 'success' });
      }).catch(function(err) {
        console.error('创建文件夹失败:', err);
        self.$store.commit('toast/SHOW_TOAST', { message: '创建文件夹失败', type: 'error' });
      });
    },
    renameResource: function(item) {
      this.renameItem = item;
      this.renameValue = item.name;
      this.showRenameModal = true;
    },
    confirmRename: function() {
      var self = this;
      if (!self.renameValue.trim() || !self.renameItem) {
        self.$store.commit('toast/SHOW_TOAST', { message: '请输入新名称', type: 'warning' });
        return;
      }
      var oldPath = self.buildResourcePath(self.renameItem.name);
      api.patch('/resources/rename', {
        old_path: oldPath,
        new_name: self.renameValue.trim()
      }).then(function() {
        self.showRenameModal = false;
        self.loadResources();
        self.$store.commit('toast/SHOW_TOAST', { message: '重命名成功', type: 'success' });
      }).catch(function(err) {
        console.error('重命名失败:', err);
        self.$store.commit('toast/SHOW_TOAST', { message: '重命名失败', type: 'error' });
      });
    },
    moveResource: function(item) {
      this.moveItem = item;
      this.moveTargetPath = '';
      this.moveBrowserPath = '/';
      this.moveBrowserFolders = [];
      this.showMoveModal = true;
      this.loadMoveBrowserFolders('/');
    },
    loadMoveBrowserFolders: function(dirPath) {
      var self = this;
      var apiPath = dirPath === '/' ? '' : dirPath;
      api.get('/resources', { params: { path: apiPath } }).then(function(response) {
        var data = response.data.data || {};
        var files = data.files || [];
        self.moveBrowserFolders = files.filter(function(f) { return f.is_dir; });
      }).catch(function() {
        self.moveBrowserFolders = [];
      });
    },
    moveBrowserNavigate: function(folderName) {
      var self = this;
      var newPath = self.moveBrowserPath === '/' ? '/' + folderName : self.moveBrowserPath + '/' + folderName;
      self.moveBrowserPath = newPath;
      self.moveTargetPath = newPath;
      self.loadMoveBrowserFolders(newPath);
    },
    moveBrowserGoBack: function() {
      var self = this;
      if (self.moveBrowserPath === '/' || !self.moveBrowserPath) return;
      var parts = self.moveBrowserPath.split('/');
      parts.pop();
      var parentPath = parts.join('/') || '/';
      self.moveBrowserPath = parentPath;
      self.loadMoveBrowserFolders(parentPath);
    },
    confirmMove: function() {
      var self = this;
      if (!self.moveTargetPath.trim() || !self.moveItem) {
        self.$store.commit('toast/SHOW_TOAST', { message: '请选择目标路径', type: 'warning' });
        return;
      }
      var sourcePath = self.buildResourcePath(self.moveItem.name);
      var targetDir = self.moveTargetPath.trim();
      if (targetDir.charAt(0) === '/') targetDir = targetDir.substring(1);
      if (sourcePath === targetDir) {
        self.$store.commit('toast/SHOW_TOAST', { message: '源路径和目标路径相同', type: 'warning' });
        return;
      }
      api.post('/resources/move', {
        source_paths: [sourcePath],
        target_dir: targetDir
      }).then(function() {
        self.showMoveModal = false;
        self.loadResources();
        self.$store.commit('toast/SHOW_TOAST', { message: '移动成功', type: 'success' });
      }).catch(function(err) {
        var msg = '移动失败';
        if (err.response && err.response.data && err.response.data.message) {
          msg = err.response.data.message;
        }
        self.$store.commit('toast/SHOW_TOAST', { message: msg, type: 'error' });
      });
    },
    copyResource: function(item) {
      this.copyItem = item;
      this.copyTargetPath = this.resourcePath;
      this.showCopyModal = true;
    },
    confirmCopy: function() {
      var self = this;
      if (!self.copyTargetPath.trim() || !self.copyItem) {
        self.$store.commit('toast/SHOW_TOAST', { message: '请选择目标路径', type: 'warning' });
        return;
      }
      var sourcePath = self.buildResourcePath(self.copyItem.name);
      api.post('/resources/copy', {
        source_paths: [sourcePath],
        target_dir: self.copyTargetPath.trim()
      }).then(function() {
        self.showCopyModal = false;
        self.loadResources();
        self.$store.commit('toast/SHOW_TOAST', { message: '复制成功', type: 'success' });
      }).catch(function(err) {
        console.error('复制失败:', err);
        self.$store.commit('toast/SHOW_TOAST', { message: '复制失败', type: 'error' });
      });
    },
    deleteResource: function(item) {
      var self = this;
      if (self.resourcePath === '/' && item.is_dir) {
        self.$store.commit('toast/SHOW_TOAST', { message: '禁止删除一级文件夹', type: 'error' });
        return;
      }
      self.confirmDialog = {
        title: '删除资源',
        message: '确定删除 "' + item.name + '"？此操作不可撤销。',
        onConfirm: function() {
          var filePath = self.buildResourcePath(item.name);
          api.delete('/resources/file', {
            data: { path: filePath }
          }).then(function() {
            self.loadResources();
            self.$store.commit('toast/SHOW_TOAST', { message: '删除成功', type: 'success' });
          }).catch(function(err) {
            console.error('删除失败:', err);
            self.$store.commit('toast/SHOW_TOAST', { message: '删除失败', type: 'error' });
          });
        }
      };
    },

    // ======== Utility Methods ========
    formatDate: function(dateStr) {
      if (!dateStr) return '';
      var str = String(dateStr);
      if (str.indexOf('T') === -1) { str = str.replace(' ', 'T'); }
      if (str.indexOf('Z') === -1 && str.indexOf('+') === -1) { str = str + 'Z'; }
      var date = new Date(str);
      if (isNaN(date.getTime())) return '';
      var y = date.getFullYear();
      var m = (date.getMonth() + 1).toString().padStart(2, '0');
      var d = date.getDate().toString().padStart(2, '0');
      var h = date.getHours().toString().padStart(2, '0');
      var min = date.getMinutes().toString().padStart(2, '0');
      return y + '-' + m + '-' + d + ' ' + h + ':' + min;
    },
    formatUptime: function(seconds) {
      if (!seconds || seconds <= 0) return '-';
      var days = Math.floor(seconds / 86400);
      var hours = Math.floor((seconds % 86400) / 3600);
      var mins = Math.floor((seconds % 3600) / 60);
      var parts = [];
      if (days > 0) parts.push(days + '天');
      if (hours > 0) parts.push(hours + '小时');
      if (mins > 0) parts.push(mins + '分钟');
      return parts.join(' ') || '刚刚';
    },
    formatSize: function(size) {
      if (!size || size === 0) return '0 B';
      var units = ['B', 'KB', 'MB', 'GB'];
      var unitIdx = 0;
      var sz = size;
      while (sz >= 1024 && unitIdx < units.length - 1) {
        sz /= 1024;
        unitIdx++;
      }
      return Math.round(sz * 10) / 10 + ' ' + units[unitIdx];
    },
    onConfirmDialog: function() {
      if (this.confirmDialog && this.confirmDialog.onConfirm) {
        this.confirmDialog.onConfirm();
      }
      this.confirmDialog = null;
    },
    cancelConfirmDialog: function() {
      this.confirmDialog = null;
    },
    resetAllLevels: function() {
      var self = this;
      self.$modal.confirm({
        title: '危险操作',
        message: '确定要重置所有用户的等级吗？此操作不可撤销！',
        confirmText: '确认重置',
        cancelText: '取消'
      }).then(function(result) {
        if (result) {
          api.post('/level/admin/reset-all').then(function() {
            self.$store.commit('toast/SHOW_TOAST', { message: '所有用户等级已重置', type: 'success' });
          }).catch(function(err) {
            console.error('重置等级失败:', err);
            self.$store.commit('toast/SHOW_TOAST', { message: '重置等级失败', type: 'error' });
          });
        }
      }).catch(function() {});
    },
    loadGroupList: function() {
      var self = this;
      api.get('/admin/groups').then(function(response) {
        self.groupList = response.data.data || [];
      }).catch(function() {
        self.groupList = [];
      });
    },
    showClearChat: function() {
      this.clearChatRoom = 'public';
      this.showClearChatModal = true;
      this.loadGroupList();
    },
    confirmClearChat: function() {
      var self = this;
      self.clearChatLoading = true;
      api.post('/admin/clear-chat', { room: self.clearChatRoom }).then(function(response) {
        self.$store.commit('toast/SHOW_TOAST', { message: response.data.message, type: 'success' });
        self.showClearChatModal = false;
      }).catch(function(err) {
        var msg = (err.response && err.response.data && err.response.data.message) || '清除聊天记录失败';
        self.$store.commit('toast/SHOW_TOAST', { message: msg, type: 'error' });
      }).finally(function() {
        self.clearChatLoading = false;
      });
    },
    loadAdminLogs: function() {
      var self = this;
      self.logsLoading = true;
      api.get('/admin/logs', { params: { page: self.logsPage, limit: self.logsLimit } }).then(function(response) {
        var data = response.data.data;
        if (self.logsPage === 1) {
          self.adminLogs = data.logs;
        } else {
          self.adminLogs = self.adminLogs.concat(data.logs);
        }
        self.logsTotal = data.total;
        self.logsLoading = false;
      }).catch(function() {
        self.logsLoading = false;
      });
    },
    loadMoreLogs: function() {
      this.logsPage++;
      this.loadAdminLogs();
    },
    getLogActionLabel: function(action) {
      var labels = {
        disable_user: '封禁用户',
        enable_user: '解禁用户',
        edit_user: '编辑用户',
        delete_user: '删除用户',
        send_broadcast: '发送广播',
        clear_public_chat: '清除公共聊天',
        clear_group_chat: '清除群组聊天',
        reset_levels: '重置等级',
        set_officer: '设为班干',
        remove_officer: '移除班干',
        update_officer_perms: '更新班干权限',
        toggle_deepseek: '切换DeepSeek',
        batch_toggle_deepseek: '批量切换DeepSeek'
      };
      return labels[action] || action;
    },
    getLogActionClass: function(action) {
      if (action.indexOf('disable') >= 0 || action.indexOf('delete') >= 0 || action.indexOf('clear') >= 0) return 'log-danger';
      if (action.indexOf('enable') >= 0 || action.indexOf('edit') >= 0) return 'log-warning';
      return 'log-info';
    },
    toggleDeepSeekFromList: function(user, event) {
      var self = this;
      var enabled = event.target.checked;
      api.patch('/admin/ai-settings/' + user.user_id + '/deepseek', { enabled: enabled }).then(function() {
        self.$set(user, 'deepseek_enabled', enabled);
      }).catch(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '操作失败', type: 'error' });
      });
    },
    batchToggleDeepSeek: function(enabled) {
      var self = this;
      if (self.selectedUsers.length === 0) {
        self.$store.commit('toast/SHOW_TOAST', { message: '请先选择用户', type: 'warning' });
        return;
      }
      api.post('/admin/ai-settings/batch-deepseek', { user_ids: self.selectedUsers, enabled: enabled }).then(function() {
        for (var i = 0; i < self.users.length; i++) {
          if (self.selectedUsers.indexOf(self.users[i].user_id) !== -1) {
            self.$set(self.users[i], 'deepseek_enabled', enabled);
          }
        }
        for (var j = 0; j < self.allUsersFetched.length; j++) {
          if (self.selectedUsers.indexOf(self.allUsersFetched[j].user_id) !== -1) {
            self.$set(self.allUsersFetched[j], 'deepseek_enabled', enabled);
          }
        }
        self.selectedUsers = [];
        self.$store.commit('toast/SHOW_TOAST', { message: (enabled ? '启用' : '禁用') + '成功', type: 'success' });
      }).catch(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '批量操作失败', type: 'error' });
      });
    },
    // ======== Weather Alert ========
    loadWeatherSchedules: function() {
      var self = this;
      api.get('/admin/weather-alert/settings').then(function(res) {
        self.weatherSchedules = res.data.data.schedules || [];
      }).catch(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '加载天气设置失败', type: 'error' });
      });
    },
    addWeatherSchedule: function() {
      var self = this;
      if (!self.newScheduleTime) {
        self.$store.commit('toast/SHOW_TOAST', { message: '请选择时间', type: 'warning' });
        return;
      }
      api.post('/admin/weather-alert/settings', { schedule_time: self.newScheduleTime }).then(function(res) {
        self.weatherSchedules.push(res.data.data);
        self.newScheduleTime = '';
        self.$store.commit('toast/SHOW_TOAST', { message: '添加成功', type: 'success' });
      }).catch(function(err) {
        self.$store.commit('toast/SHOW_TOAST', { message: (err.response && err.response.data && err.response.data.message) || '添加失败', type: 'error' });
      });
    },
    deleteWeatherSchedule: function(id) {
      var self = this;
      api.delete('/admin/weather-alert/settings/' + id).then(function() {
        self.weatherSchedules = self.weatherSchedules.filter(function(s) { return s.id !== id; });
        self.$store.commit('toast/SHOW_TOAST', { message: '已删除', type: 'success' });
      }).catch(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '删除失败', type: 'error' });
      });
    },
    toggleWeatherSchedule: function(schedule) {
      var self = this;
      var enabled = !schedule.enabled;
      api.patch('/admin/weather-alert/settings/' + schedule.id, { enabled: enabled }).then(function() {
        self.$set(schedule, 'enabled', enabled);
      }).catch(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '操作失败', type: 'error' });
      });
    },
    checkWeatherNow: function() {
      var self = this;
      self.weatherCheckResult = null;
      api.get('/admin/weather-alert/check').then(function(res) {
        self.weatherCheckResult = res.data.data;
      }).catch(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '天气检查失败', type: 'error' });
      });
    },
    broadcastWeatherAlert: function() {
      var self = this;
      if (!self.weatherCheckResult) return;
      var data = self.weatherCheckResult;
      var alertType = 'both';
      if (data.has_rain && !data.has_warning) alertType = 'rain';
      else if (!data.has_rain && data.has_warning) alertType = 'warning';
      api.post('/admin/weather-alert/broadcast', {
        alert_type: alertType,
        rain_text: data.rain_text || '',
        warnings: data.warnings || []
      }).then(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '天气提醒已广播', type: 'success' });
      }).catch(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '广播失败', type: 'error' });
      });
    },

    // ======== App Control ========
    loadAppControl: function() {
      var self = this;
      self.appControlLoading = true;
      api.get('/admin/app-control').then(function(res) {
        self.appControlApps = res.data.data.apps || [];
      }).catch(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '加载应用管控状态失败', type: 'error' });
      }).finally(function() {
        self.appControlLoading = false;
      });
    },
    toggleAppControl: function(app) {
      var self = this;
      // settings 应用不允许禁用（后端也会校验）
      if (app.name === 'settings' && app.enabled) {
        self.$store.commit('toast/SHOW_TOAST', { message: '设置应用不允许禁用', type: 'warning' });
        return;
      }
      var newEnabled = !app.enabled;
      api.put('/admin/app-control/' + app.name, { enabled: newEnabled }).then(function() {
        app.enabled = newEnabled;
        // 清除路由守卫的应用管控缓存，确保下次路由跳转获取最新状态
        if (self.$router && self.$router.clearAppControlCache) {
          self.$router.clearAppControlCache();
        }
        self.$store.commit('toast/SHOW_TOAST', {
          message: newEnabled ? (app.label + ' 已启用') : (app.label + ' 已禁用'),
          type: 'success'
        });
      }).catch(function(err) {
        var msg = (err.response && err.response.data && err.response.data.message) || '操作失败';
        self.$store.commit('toast/SHOW_TOAST', { message: msg, type: 'error' });
      });
    }
  }
};
</script>

<style scoped>
/* ====== Base Layout ====== */
.admin-page {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-color);
}

/* ====== Tabs ====== */
.admin-tabs {
  display: flex;
  gap: 0;
  padding: 0 32px;
  background: var(--card-bg);
  border-bottom: 0.5px solid var(--separator-color);
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}

.admin-tabs::-webkit-scrollbar {
  display: none;
}

.admin-tab {
  padding: 14px 24px;
  min-height: 44px;
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-medium);
  color: var(--text-secondary);
  border-bottom: 2px solid transparent;
  transition: color var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
  white-space: nowrap;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.admin-tab.active {
  color: var(--primary-color);
  border-bottom-color: var(--primary-color);
}

.admin-tab:hover {
  color: var(--text-primary);
}

.admin-tab:active {
  transform: scale(0.92);
  opacity: 0.7;
}

/* ====== Content Area ====== */
.admin-content {
  flex: 1;
  overflow-y: auto;
  padding: 24px 32px;
  min-height: 0;
}

.admin-section {
  max-width: 1100px;
}

/* ====== Section Toolbar ====== */
.section-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 12px;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.toolbar-actions-row {
  justify-content: flex-start;
}

.search-input {
  width: 260px;
  height: 44px;
  padding: 0 14px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  background: var(--card-bg);
  transition: border-color var(--duration-fast) var(--ease-standard);
}

.search-input:focus {
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px var(--primary-light);
  outline: none;
}

.filter-select {
  height: 44px;
  padding: 0 30px 0 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  background: var(--card-bg);
  -webkit-appearance: none;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23999' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  cursor: pointer;
}

.filter-select:focus {
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px var(--primary-light);
  outline: none;
}

.filter-select-sm {
  height: 44px;
  padding: 0 28px 0 10px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-caption);
  color: var(--text-primary);
  background: var(--card-bg);
  -webkit-appearance: none;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23999' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
  cursor: pointer;
}

/* ====== Data Table (iOS Inset Grouped) ====== */
.data-table-wrapper {
  overflow-x: auto;
  border-radius: var(--radius-lg);
  background: var(--card-bg);
  border: 0.5px solid var(--separator-color);
  box-shadow: var(--shadow-sm);
}

.data-table {
  width: 100%;
  border-collapse: collapse;
}

.data-table th {
  padding: 12px 16px;
  text-align: left;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--text-secondary);
  background: var(--bg-color);
  border-bottom: 0.5px solid var(--separator-color);
  position: sticky;
  top: 0;
  z-index: 1;
}

.data-table td {
  padding: 12px 16px;
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  border-bottom: 0.5px solid var(--separator-color);
  vertical-align: middle;
}

.data-table tr:last-child td {
  border-bottom: none;
}

/* Zebra striping */
.data-table tbody tr.row-even {
  background: var(--bg-color);
}

/* Hover effect */
.data-table tbody tr:not(.detail-row):hover {
  background: rgba(var(--primary-rgb), 0.04);
  cursor: pointer;
}

.data-table tbody tr.expanded-row {
  background: rgba(var(--primary-rgb), 0.06);
}

.col-checkbox {
  width: 40px;
  text-align: center;
}

.col-checkbox input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: var(--primary-color);
}

/* Status & Role Badges */
.status-badge {
  display: inline-block;
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-caption);
  font-weight: 500;
}

.status-badge.active {
  background: rgba(var(--success-rgb), 0.1);
  color: var(--success-color);
}

.status-badge.disabled {
  background: rgba(var(--danger-rgb), 0.1);
  color: var(--danger-color);
}

.role-badge {
  display: inline-block;
  padding: 3px 10px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-caption);
  font-weight: 500;
}

.gender-badge {
  display: inline-block;
  padding: 3px 10px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-caption);
  font-weight: 500;
}
.gender-badge.male {
  background: rgba(var(--primary-rgb), 0.1);
  color: var(--info-color);
}
.gender-badge.female {
  background: rgba(175, 82, 222, 0.1);
  color: var(--accent-ai);
}
.gender-badge.unknown {
  background: rgba(156, 163, 175, 0.1);
  color: var(--text-tertiary);
}
.role-badge.admin-badge {
  background: rgba(var(--warning-rgb), 0.12);
  color: var(--warning-color);
  border: 1px solid rgba(var(--warning-rgb), 0.2);
}
.role-badge.user-badge {
  background: rgba(156, 163, 175, 0.1);
  color: var(--text-tertiary);
  border: 1px solid rgba(156, 163, 175, 0.1);
}
.protected-hint {
  font-size: var(--font-size-caption);
  color: var(--warning-color);
  display: flex;
  align-items: center;
  gap: 4px;
}
.perm-tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: var(--radius-xs);
  font-size: var(--font-size-caption2);
  background: rgba(var(--primary-rgb), 0.08);
  color: var(--info-color);
  margin: 2px 4px 2px 0;
  border: 1px solid rgba(var(--primary-rgb), 0.12);
}
.detail-actions-row {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 0.5px solid var(--separator-color);
}
.btn-danger {
  background: var(--danger-color) !important;
}
.btn-danger:hover:not(:disabled) {
  background: rgba(var(--danger-rgb), 0.85) !important;
}

.action-cell {
  display: flex;
  gap: 6px;
}

.table-btn {
  padding: 5px 12px;
  min-height: 44px;
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-caption);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  background: var(--bg-color);
  color: var(--text-primary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
}

.table-btn.sm {
  padding: 4px 10px;
  min-height: 44px;
  font-size: var(--font-size-caption2);
}

.table-btn:hover {
  background: var(--border-color);
}

.table-btn:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.table-btn.disable {
  background: rgba(var(--warning-rgb), 0.1);
  color: var(--warning-color);
}

.table-btn.enable {
  background: rgba(var(--success-rgb), 0.1);
  color: var(--success-color);
}

.table-btn.danger {
  background: rgba(var(--danger-rgb), 0.1);
  color: var(--danger-color);
}

.table-btn.danger:hover {
  background: rgba(var(--danger-rgb), 0.2);
}

.table-btn.edit {
  background: rgba(var(--primary-rgb), 0.1);
  color: var(--primary-color);
}

.table-btn.edit:hover {
  background: rgba(var(--primary-rgb), 0.2);
}

/* Detail Row */
.detail-row td {
  padding: 0 !important;
  border-bottom: none !important;
}

.user-detail-panel {
  padding: 16px 20px;
  background: rgba(var(--primary-rgb), 0.03);
  animation: slideDown 0.2s ease;
}

@keyframes slideDown {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-label {
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
}

.detail-value {
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--text-primary);
}

.edit-detail-btn {
  margin-top: 4px;
}

/* Load More */
.load-more-wrap {
  text-align: center;
  padding: 16px 0;
  border-top: 0.5px solid var(--separator-color);
}

.load-more-btn {
  padding: 8px 24px;
  min-height: 44px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--card-bg);
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: border-color var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
}

.load-more-btn:hover {
  border-color: var(--primary-color);
  color: var(--primary-color);
}

.load-more-btn:active {
  transform: scale(0.92);
  opacity: 0.7;
}

/* ====== Loading State ====== */
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  gap: 16px;
}

.spinner {
  width: 36px;
  height: 36px;
  border: 3px solid var(--border-color);
  border-top-color: var(--primary-color);
  border-radius: 50%;
  animation: spin 0.8s var(--ease-standard) infinite;
}

.loading-container p {
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  margin: 0;
}

/* ====== Empty State ====== */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  background: var(--card-bg);
  border-radius: var(--radius-lg);
}

.empty-icon {
  font-size: 48px;
  color: var(--border-color);
  margin-bottom: 12px;
}

.empty-text {
  color: var(--text-secondary);
  font-size: var(--font-size-body);
  margin: 0;
}

.td-truncate {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.post-type-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: var(--radius-md);
  font-size: var(--font-size-caption);
  font-weight: 500;
}
.post-type-badge.forum { background: rgba(var(--primary-rgb), 0.15); color: var(--info-color); }
.post-type-badge.food { background: rgba(var(--warning-rgb), 0.15); color: var(--warning-color); }
.post-type-badge.hot { background: rgba(var(--danger-rgb), 0.15); color: var(--danger-color); }
.post-type-badge.poll { background: rgba(88, 86, 214, 0.15); color: var(--accent-resource); }
.post-type-badge.survey { background: rgba(var(--success-rgb), 0.15); color: var(--success-color); }

.load-more-container {
  display: flex;
  justify-content: center;
  padding: 16px 0;
}

.modal-card-lg {
  max-width: 720px;
  width: 90vw;
}

.chat-msg-list {
  max-height: 400px;
  overflow-y: auto;
  padding: 8px 0;
}

.chat-msg-item {
  padding: 8px 12px;
  border-bottom: 0.5px solid var(--separator-color);
}

.chat-msg-item:last-child {
  border-bottom: none;
}

.chat-msg-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.chat-msg-sender {
  font-weight: 600;
  font-size: var(--font-size-sm);
  color: var(--text-primary);
}

.chat-msg-time {
  font-size: var(--font-size-caption2);
  color: var(--text-secondary);
}

.chat-msg-content {
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  word-break: break-word;
  line-height: 1.5;
}

.sub-section {
  margin-top: 20px;
}

.count-badge {
  display: inline-block;
  background: var(--primary-color);
  color: var(--card-bg);
  font-size: var(--font-size-caption);
  padding: 1px 8px;
  border-radius: var(--radius-md);
  margin-left: 6px;
  font-weight: var(--font-weight-regular);
}

/* ====== Action Buttons ====== */
.action-btn {
  padding: 8px 16px;
  min-height: 44px;
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  background: var(--primary-color);
  color: var(--card-bg);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
  white-space: nowrap;
}

.action-btn:hover:not(:disabled) {
  background: var(--primary-hover);
}

.action-btn:active:not(:disabled) {
  transform: scale(0.92);
  opacity: 0.7;
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.danger-btn {
  background: var(--danger-color) !important;
}

.danger-btn:hover {
  opacity: 0.9 !important;
}

.relay-status-panel {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  padding: 16px;
}
.relay-info-card {
  background: var(--card-bg);
  border-radius: var(--radius-md);
  padding: 16px;
  border: 1px solid var(--border-color);
}
.relay-info-label {
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  margin-bottom: 8px;
}
.relay-info-value {
  font-size: var(--font-size-callout);
  font-weight: 600;
  color: var(--text-primary);
  word-break: break-all;
}
.status-active {
  color: var(--success-color);
}
.text-muted {
  color: var(--text-secondary);
}
.relay-sync-section {
  margin-top: 16px;
}
.sync-result-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
.sync-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: rgba(var(--success-rgb), 0.1);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  color: var(--success-color);
  font-weight: 500;
}
.sync-state-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-top: 8px;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}
.relay-actions {
  margin-top: 20px;
  display: flex;
  gap: 12px;
}
.peer-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.peer-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: var(--bg-color);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
}
.peer-name {
  font-weight: 500;
}
.status-pending {
  color: var(--warning-color);
  font-size: var(--font-size-caption);
}
.status-inactive {
  color: var(--danger-color);
  font-size: var(--font-size-caption);
}

/* ====== Broadcast ====== */
.broadcast-form {
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  padding: 24px;
  margin-bottom: 24px;
}

.sub-title {
  font-size: var(--font-size-callout);
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 12px;
}

.perm-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.perm-desc {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  margin-bottom: 16px;
}

.perm-empty {
  text-align: center;
  padding: 40px 20px;
  color: var(--text-tertiary);
}

.perm-empty i {
  font-size: 32px;
  margin-bottom: 12px;
  display: block;
  opacity: 0.4;
}

.officer-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.officer-card {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 16px;
}

.officer-info {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.officer-avatar {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  background: var(--primary-lighter);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--primary-color);
  font-size: var(--font-size-callout);
}

.officer-name {
  font-weight: 600;
  color: var(--text-primary);
  font-size: var(--font-size-sm);
  display: flex;
  align-items: center;
  gap: 6px;
}

.officer-title-badge {
  font-size: var(--font-size-caption2);
  font-weight: 500;
  padding: 1px 8px;
  border-radius: var(--radius-md);
  background: rgba(var(--primary-rgb), 0.15);
  color: var(--info-color);
  white-space: nowrap;
}

.officer-id {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
}

.officer-perm-count {
  font-size: var(--font-size-caption2);
  color: var(--text-secondary);
  margin-top: 2px;
}

.officer-perms {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}

.perm-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-caption);
  background: var(--bg-color);
  color: var(--text-tertiary);
  border: 1px solid var(--border-color);
  transition: background 0.15s var(--ease-standard), color 0.15s var(--ease-standard), border-color 0.15s var(--ease-standard);
}

.perm-tag.active {
  background: var(--primary-lighter);
  color: var(--primary-color);
  border-color: var(--primary-color);
}

.perm-tag.editing {
  cursor: pointer;
}

.perm-tag.editing:hover {
  box-shadow: var(--shadow-sm);
}

.perm-tag.selectable {
  cursor: pointer;
}

.perm-tag.selectable:hover {
  border-color: var(--primary-color);
}

.perm-select-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.ann-admin-form {
  margin-bottom: 16px;
}

.ann-admin-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ann-admin-item {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 14px;
}

.ann-admin-item.pinned {
  border-color: var(--primary-color);
}

.ann-admin-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.ann-admin-item-badges {
  display: flex;
  gap: 6px;
}

.ann-admin-item-time {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
}

.ann-admin-item-title {
  font-weight: 600;
  color: var(--text-primary);
  font-size: var(--font-size-sm);
  margin-bottom: 4px;
}

.ann-admin-item-content {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  margin-bottom: 10px;
}

.ann-admin-item-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 8px;
  border-top: 0.5px solid var(--separator-color);
}

.ann-admin-item-author {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
}

.ann-admin-item-actions {
  display: flex;
  gap: 6px;
}

.officer-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.broadcast-input {
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  background: var(--bg-color);
  resize: vertical;
  margin-bottom: 12px;
  font-family: inherit;
}

.broadcast-input:focus {
  border-color: var(--primary-color);
  outline: none;
}

.btn-primary {
  padding: 10px 24px;
  min-height: 44px;
  border: none;
  background: var(--primary-color);
  color: var(--card-bg);
  border-radius: var(--radius-md);
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-semibold);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
}

.btn-primary:hover:not(:disabled) {
  background: var(--primary-hover);
}

.btn-primary:active:not(:disabled) {
  transform: scale(0.92);
  opacity: 0.7;
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.broadcast-history {
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  padding: 24px;
}

.broadcast-item {
  padding: 14px 0;
  border-bottom: 0.5px solid var(--separator-color);
}

.broadcast-item:last-child {
  border-bottom: none;
}

.bc-content {
  font-size: var(--font-size-body);
  color: var(--text-primary);
  margin-bottom: 4px;
  line-height: 1.5;
}

.bc-meta {
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
}

/* ====== Stats Overview Cards (Monitor) ====== */
.stats-overview {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 14px;
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  padding: 20px;
}

.stat-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  font-size: var(--font-size-headline);
  background: rgba(var(--primary-rgb), 0.1);
  color: var(--primary-color);
}

.stat-info {
  display: flex;
  flex-direction: column;
}

.stat-value {
  font-size: var(--font-size-headline);
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
}

.stat-label {
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
}

/* Monitor Grid */
.monitor-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
  margin-bottom: 24px;
}

.monitor-card {
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  padding: 24px;
}

.monitor-label {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  margin-bottom: 12px;
}

.progress-bar {
  height: 8px;
  background: var(--border-color);
  border-radius: var(--radius-xs);
  overflow: hidden;
  margin-bottom: 8px;
}

.progress-fill {
  height: 100%;
  border-radius: var(--radius-xs);
  transition: width 0.5s var(--ease-standard);
}

.progress-fill.normal {
  background: var(--success-color);
}

.progress-fill.warning {
  background: var(--warning-color);
}

.progress-fill.critical {
  background: var(--danger-color);
}

.monitor-value {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
}

.monitor-info {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  padding: 24px;
}

.info-item {
  text-align: center;
}

.info-label {
  display: block;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.info-value {
  font-size: var(--font-size-subheadline);
  font-weight: 600;
  color: var(--text-primary);
}

.auto-refresh-hint {
  text-align: center;
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  margin-top: 16px;
}

/* ====== PM2 ====== */
.pm2-process-card {
  background: var(--card-bg);
  border-radius: var(--radius-md);
  padding: 20px;
  margin-bottom: 16px;
  border: 1px solid var(--border-color);
}
.pm2-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.pm2-status-badge {
  padding: 4px 12px;
  border-radius: var(--radius-xl);
  font-size: var(--font-size-caption);
  font-weight: 700;
  letter-spacing: 0.5px;
}
.pm2-status-badge.online { background: rgba(var(--success-rgb), 0.15); color: var(--success-color); }
.pm2-status-badge.stopped { background: rgba(var(--danger-rgb), 0.15); color: var(--danger-color); }
.pm2-status-badge.stopping, .pm2-status-badge.errored { background: rgba(var(--warning-rgb), 0.15); color: var(--warning-color); }
.pm2-name { font-weight: 700; font-size: var(--font-size-callout); }
.pm2-mode { font-size: var(--font-size-caption); color: var(--text-secondary); background: var(--bg-color); padding: 2px 8px; border-radius: var(--radius-xs); }
.pm2-pid { font-size: var(--font-size-caption); color: var(--text-secondary); margin-left: auto; }
.pm2-metrics { display: flex; flex-direction: column; gap: 12px; margin-bottom: 16px; }
.pm2-metric { display: flex; align-items: center; gap: 12px; }
.pm2-metric-label { width: 60px; font-size: var(--font-size-sm); color: var(--text-secondary); flex-shrink: 0; }
.pm2-metric-value { width: 70px; text-align: right; font-size: var(--font-size-sm); font-weight: 600; flex-shrink: 0; }
.pm2-details { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; }
.pm2-logs-section { margin-top: 8px; }
.pm2-log-viewer {
  background: #0d1117;
  border-radius: var(--radius-sm);
  padding: 12px;
  max-height: 400px;
  overflow-y: auto;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: var(--font-size-caption);
  line-height: 1.6;
}
.pm2-log-line {
  color: #c9d1d9;
  white-space: pre-wrap;
  word-break: break-all;
  border-bottom: 0.5px solid rgba(255,255,255,0.04);
  padding: 2px 0;
}
.pm2-log-error { color: var(--danger-color); }
.action-btn.active { background: var(--primary-color); color: var(--card-bg); }

/* ====== Resources ====== */
.resource-toolbar {
  flex-wrap: wrap;
}

.resource-stats-bar {
  display: flex;
  gap: 16px;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}

.res-stat {
  padding: 4px 10px;
  background: var(--bg-color);
  border-radius: var(--radius-sm);
}

.breadcrumb {
  font-size: var(--font-size-sm);
  word-break: break-all;
}

.breadcrumb a {
  color: var(--primary-color);
  cursor: pointer;
  transition: opacity 0.15s;
}

.breadcrumb a:hover {
  opacity: 0.7;
  text-decoration: underline;
}

.search-input-sm {
  width: 180px;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  background: var(--card-bg);
  transition: border-color 0.2s;
}

.search-input-sm:focus {
  border-color: var(--primary-color);
  outline: none;
}

.resource-list {
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.resource-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 20px;
  border-bottom: 0.5px solid var(--separator-color);
  font-size: var(--font-size-sm);
  transition: background 0.15s;
}

.resource-row:last-child {
  border-bottom: none;
}

.resource-row:hover {
  background: var(--bg-color);
}

.res-icon {
  width: 28px;
  text-align: center;
  flex-shrink: 0;
}

.res-fa-icon {
  font-size: var(--font-size-callout);
  color: var(--primary-color);
}

.fa-folder.res-fa-icon,
.res-fa-icon.fa-folder {
  color: var(--warning-color);
}

.res-name {
  flex: 1;
  color: var(--text-primary);
  cursor: pointer;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.res-name:hover {
  color: var(--primary-color);
}

.res-size {
  width: 80px;
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  flex-shrink: 0;
}

.res-path {
  flex: 1;
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.res-date {
  width: 140px;
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  flex-shrink: 0;
}

.res-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

/* ====== Modals ====== */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: var(--glass-blur-overlay);
  -webkit-backdrop-filter: var(--glass-blur-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  padding: 20px;
}

.modal-card {
  width: 420px;
  max-width: 95vw;
  background: var(--card-bg);
  border-radius: var(--radius-2xl);
  padding: 28px;
  box-shadow: var(--shadow-xl);
  animation: modalIn var(--duration-normal) var(--ease-decelerate);
}

.modal-card.modal-small {
  width: 380px;
}

.modal-card.modal-lg {
  width: 520px;
}

@keyframes modalIn {
  from { opacity: 0; transform: scale(0.96) translateY(10px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

.modal-title {
  font-size: var(--font-size-subheadline);
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 16px;
}

.move-source-info {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding: 8px 12px;
  background: var(--primary-lighter);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
}

.move-source-label {
  color: var(--text-secondary);
  flex-shrink: 0;
}

.move-source-name {
  color: var(--text-primary);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.move-browser {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  overflow: hidden;
  margin-bottom: 12px;
}

.move-browser-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--bg-color);
  border-bottom: 0.5px solid var(--separator-color);
}

.move-browser-back {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-sm);
  border: none;
  background: var(--card-bg);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-caption);
  transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
}

.move-browser-back:hover:not(:disabled) {
  background: var(--primary-light);
  color: var(--primary-color);
}

.move-browser-back:active:not(:disabled) {
  transform: scale(0.92);
  opacity: 0.7;
}

.move-browser-back:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.move-browser-path {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.move-browser-list {
  max-height: 200px;
  overflow-y: auto;
  padding: 4px;
}

.move-browser-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  transition: background 0.15s;
}

.move-browser-item:hover {
  background: var(--primary-lighter);
}

.move-browser-item.active {
  background: var(--primary-light);
  color: var(--primary-color);
  font-weight: 500;
}

.move-browser-item i {
  font-size: var(--font-size-sm);
  color: var(--warning-color);
  width: 18px;
  text-align: center;
}

.move-browser-item.active i {
  color: var(--primary-color);
}

.move-browser-empty {
  padding: 20px;
  text-align: center;
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
}

.modal-desc {
  font-size: var(--font-size-body);
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 0 0 8px;
}

.btn-confirm-danger {
  background: var(--danger-color) !important;
}

.btn-confirm-danger:hover {
  opacity: 0.9;
}

.form-input {
  width: 100%;
  height: 44px;
  padding: 0 14px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  font-size: var(--font-size-body);
  color: var(--text-primary);
  background: var(--bg-color);
  transition: border-color var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard);
  box-sizing: border-box;
}

.form-input:focus {
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px var(--primary-light);
  outline: none;
}

.form-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  background: var(--border-color);
}

.form-textarea {
  height: auto;
  padding: 10px 14px;
  resize: vertical;
  min-height: 80px;
  line-height: 1.5;
}
.ban-reason-text {
  color: var(--danger-color);
}

/* Edit Form */
.edit-form {
  margin-bottom: 8px;
}

.form-group {
  margin-bottom: 16px;
}

.form-label {
  display: block;
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 20px;
}

.btn-cancel {
  padding: 10px 20px;
  min-height: 44px;
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-medium);
  color: var(--text-secondary);
  background: var(--bg-color);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
}

.btn-cancel:hover {
  background: var(--border-color);
}

.btn-cancel:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.btn-confirm {
  padding: 10px 20px;
  min-height: 44px;
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-semibold);
  color: var(--card-bg);
  background: var(--primary-color);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
}

.btn-confirm:hover {
  background: var(--primary-hover);
}

.btn-confirm:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.logs-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.log-item {
  background: var(--bg-color);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 14px 18px;
}
.log-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.log-action {
  display: inline-block;
  padding: 3px 10px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-caption);
  font-weight: 600;
}
.log-action.log-danger {
  background: rgba(var(--danger-rgb), 0.12);
  color: var(--danger-color);
}
.log-action.log-warning {
  background: rgba(var(--warning-rgb), 0.12);
  color: var(--warning-color);
}
.log-action.log-info {
  background: rgba(var(--primary-rgb), 0.12);
  color: var(--info-color);
}
.log-time {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
}
.log-body {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}
.log-admin {
  color: var(--text-primary);
  font-weight: 500;
}
.log-target {
  color: var(--text-secondary);
}
.log-detail {
  color: var(--text-tertiary);
  font-style: italic;
}
.log-merged {
  border-left: 3px solid rgba(139,92,246,0.5);
  background: rgba(139,92,246,0.04);
}
.log-count {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 7px;
  border-radius: var(--radius-md);
  background: rgba(88, 86, 214, 0.2);
  color: var(--accent-resource);
  font-size: var(--font-size-caption2);
  font-weight: var(--font-weight-bold);
  vertical-align: middle;
  line-height: 1.4;
}

/* ====== Transitions ====== */
.tab-fade-enter-active,
.tab-fade-leave-active {
  transition: opacity 0.2s var(--ease-standard);
}

.tab-fade-enter,
.tab-fade-leave-to {
  opacity: 0;
}

.modal-fade-enter-active {
  transition: opacity 0.25s var(--ease-standard), transform 0.3s var(--ease-spring);
}
.modal-fade-leave-active {
  transition: opacity 0.15s var(--ease-accelerate), transform 0.15s var(--ease-accelerate);
}

.modal-fade-enter {
  opacity: 0;
  transform: scale(0.92) translateY(8px);
}
.modal-fade-leave-to {
  opacity: 0;
  transform: scale(0.97) translateY(-4px);
}

/* ====== Responsive: Tablet (768px - 1024px) ====== */
@media (max-width: 1024px) {
  .stats-overview {
    grid-template-columns: repeat(2, 1fr);
  }

  .monitor-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .monitor-info {
    grid-template-columns: repeat(2, 1fr);
  }

  .detail-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .admin-content {
    padding: 20px 24px;
  }

  .admin-tabs {
    padding: 0 24px;
  }
}

/* ====== Responsive: Mobile (<768px) ====== */
@media (max-width: 768px) {
  .admin-tabs {
    padding: 0 12px;
  }

  .admin-tab {
    padding: 12px 16px;
    font-size: var(--font-size-sm);
  }

  .admin-content {
    padding: 16px 12px;
  }

  .section-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .toolbar-left,
  .toolbar-right {
    width: 100%;
    justify-content: flex-start;
  }

  .search-input {
    width: 100%;
    box-sizing: border-box;
  }

  .filter-select,
  .filter-select-sm {
    flex: 1;
    min-width: 0;
  }

  /* Table becomes card layout on mobile */
  .data-table-wrapper {
    border-radius: var(--radius-md);
  }

  .data-table thead {
    display: none;
  }

  .data-table tbody tr {
    display: block;
    margin-bottom: 12px;
    border: 1px solid var(--border-color);
    border-radius: 10px;
    padding: 12px;
    background: var(--card-bg);
  }

  .data-table tbody tr.row-even {
    background: var(--card-bg);
  }

  .data-table tbody tr:not(.detail-row):hover {
    background: var(--card-bg);
  }

  .data-table td {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 0;
    border-bottom: 0.5px solid rgba(128, 128, 128, 0.1);
    font-size: var(--font-size-sm);
  }

  .data-table td::before {
    content: attr(data-label);
    font-weight: 600;
    color: var(--text-secondary);
    font-size: var(--font-size-caption);
    margin-right: 12px;
    flex-shrink: 0;
  }

  .data-table tr:last-child td {
    border-bottom: none;
  }

  .data-table tr.detail-row td {
    padding: 0;
  }

  .col-checkbox {
    position: absolute;
    top: 12px;
    right: 12px;
  }

  .action-cell {
    justify-content: flex-end;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 0.5px solid var(--separator-color);
  }

  /* Stats cards stack on mobile */
  .stats-overview {
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .stat-card {
    padding: 14px;
  }

  .stat-icon {
    width: 40px;
    height: 40px;
    font-size: var(--font-size-callout);
  }

  .stat-value {
    font-size: var(--font-size-callout);
  }

  .monitor-grid {
    grid-template-columns: 1fr;
  }

  .monitor-info {
    grid-template-columns: 1fr;
  }

  .detail-grid {
    grid-template-columns: 1fr;
  }

  /* Resource list mobile */
  .resource-row {
    flex-wrap: wrap;
    gap: 8px;
    padding: 10px 14px;
  }

  .res-path {
    display: none;
  }

  .res-date {
    width: auto;
  }

  .res-size {
    width: auto;
  }

  .toolbar-actions-row {
    flex-wrap: wrap;
  }

  .search-input-sm {
    width: 100%;
    box-sizing: border-box;
  }

  .resource-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .breadcrumb {
    font-size: var(--font-size-sm);
  }

  .modal-card {
    width: 95vw;
    padding: 20px;
  }

  .modal-card.modal-lg {
    width: 95vw;
  }

  .broadcast-form,
  .broadcast-history {
    padding: 16px;
  }

  .empty-icon {
    font-size: 36px;
  }

  .empty-text {
    font-size: var(--font-size-sm);
  }
}

@media (max-width: 480px) {
  .stats-overview {
    grid-template-columns: 1fr;
  }

  .admin-tab {
    padding: 10px 12px;
    font-size: var(--font-size-sm);
  }
}

.toggle-switch {
  position: relative;
  display: inline-block;
  width: 51px;
  height: 31px;
  cursor: pointer;
  flex-shrink: 0;
}

.toggle-switch input {
  display: none;
}

.toggle-slider {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(120, 120, 128, 0.16);
  border-radius: var(--radius-pill);
  transition: background var(--duration-normal) var(--ease-standard);
}

.toggle-slider::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 27px;
  height: 27px;
  background: var(--card-bg);
  border-radius: 50%;
  box-shadow: var(--shadow-md);
  transition: transform var(--duration-normal) var(--ease-standard);
}

.toggle-switch input:checked + .toggle-slider {
  background: var(--success-color);
}

.toggle-switch input:checked + .toggle-slider::after {
  transform: translateX(20px);
}

.toggle-switch-sm {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  margin-left: 8px;
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
}

.toggle-switch-sm input {
  display: none;
}

.toggle-slider-sm {
  position: relative;
  width: 51px;
  height: 31px;
  background: rgba(120, 120, 128, 0.16);
  border-radius: var(--radius-pill);
  transition: background var(--duration-normal) var(--ease-standard);
  flex-shrink: 0;
}

.toggle-slider-sm::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 27px;
  height: 27px;
  background: var(--card-bg);
  border-radius: 50%;
  box-shadow: var(--shadow-md);
  transition: transform var(--duration-normal) var(--ease-standard);
}

.toggle-switch-sm input:checked + .toggle-slider-sm {
  background: var(--success-color);
}

.toggle-switch-sm input:checked + .toggle-slider-sm::after {
  transform: translateX(20px);
}

.toggle-label-sm {
  white-space: nowrap;
}

.model-tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: var(--radius-xs);
  font-size: var(--font-size-caption2);
  font-weight: 600;
}

.model-tag.default {
  background: rgba(var(--primary-rgb), 0.1);
  color: var(--info-color);
}

.model-tag.deepseek {
  background: rgba(var(--success-rgb), 0.1);
  color: var(--success-color);
}

.section-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  gap: 12px;
  flex-wrap: wrap;
}

.toolbar-left {
  display: flex;
  gap: 8px;
  align-items: center;
}

.toolbar-right {
  display: flex;
  gap: 8px;
  align-items: center;
}

.toolbar-input {
  padding: 6px 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  background: var(--card-bg);
  color: var(--text-primary);
  min-width: 200px;
}

.admin-btn {
  padding: 6px 14px;
  min-height: 44px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  border: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
}

.admin-btn.primary {
  background: var(--info-color);
  color: var(--card-bg);
}

.admin-btn.primary:hover {
  background: var(--primary-hover);
}

.admin-btn.danger {
  background: var(--danger-color);
  color: var(--card-bg);
}

.admin-btn.danger:hover {
  background: rgba(var(--danger-rgb), 0.85);
}

.admin-btn:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.admin-btn.sm {
  padding: 3px 10px;
  min-height: 44px;
  font-size: var(--font-size-caption);
}

.admin-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px;
  color: var(--text-secondary);
}

.spinner-sm {
  width: 16px;
  height: 16px;
  border: 2px solid var(--border-color);
  border-top-color: var(--info-color);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.admin-empty {
  text-align: center;
  padding: 40px;
  color: var(--text-secondary);
}

.weather-schedule-section {
  margin-top: 16px;
}

.schedule-add-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 16px;
}

.weather-check-result {
  margin-top: 20px;
  padding: 12px;
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
}

.check-result-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.check-item {
  padding: 10px;
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
}

.check-item.has-alert {
  border-color: rgba(var(--danger-rgb), 0.3);
  background: rgba(var(--danger-rgb), 0.05);
}

.check-label {
  display: block;
  font-size: var(--font-size-caption2);
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.check-value {
  font-size: var(--font-size-sm);
  font-weight: 500;
}

.warning-tag {
  display: inline-block;
  background: rgba(var(--danger-rgb), 0.1);
  color: var(--danger-color);
  padding: 2px 8px;
  border-radius: var(--radius-xs);
  font-size: var(--font-size-caption);
  margin: 2px 4px 2px 0;
}

.pagination-info {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}
.mode-btn {
  padding: 8px 16px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-color);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: var(--font-size-sm);
  transition: background 0.2s var(--ease-standard), color 0.2s var(--ease-standard), border-color 0.2s var(--ease-standard);
  display: flex;
  align-items: center;
  gap: 6px;
}
.mode-btn:hover {
  background: var(--bg-color);
  color: var(--text-primary);
}
.mode-btn-active {
  background: rgba(var(--primary-rgb), 0.2);
  border-color: rgba(var(--primary-rgb), 0.5);
  color: var(--info-color);
}
.mode-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.relay-action-btn {
  padding: 8px 16px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-color);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: var(--font-size-sm);
  transition: background 0.2s var(--ease-standard), color 0.2s var(--ease-standard), border-color 0.2s var(--ease-standard);
  display: flex;
  align-items: center;
  gap: 6px;
}
.relay-action-btn:hover {
  background: var(--bg-color);
}
.relay-action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.relay-action-disconnect {
  border-color: rgba(var(--danger-rgb), 0.3);
  color: var(--danger-color);
}
.relay-action-disconnect:hover {
  background: rgba(var(--danger-rgb), 0.1);
}
.relay-action-connect {
  border-color: rgba(var(--success-rgb), 0.3);
  color: var(--success-color);
}
.relay-action-connect:hover {
  background: rgba(var(--success-rgb), 0.1);
}

/* ====== App Control ====== */
.app-control-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 16px;
}
.app-control-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: var(--bg-color);
  border: 0.5px solid var(--separator-color);
  border-radius: var(--radius-lg);
  min-width: 220px;
  flex: 1 1 220px;
  max-width: 320px;
  transition: background 0.2s var(--ease-standard);
}
.app-control-card:active {
  background: var(--border-color);
}
.app-control-card.disabled {
  opacity: 0.55;
}
.app-control-icon {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 18px;
  flex-shrink: 0;
}
.app-control-info {
  flex: 1;
  min-width: 0;
}
.app-control-name {
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-medium);
  color: var(--text-color);
}
.app-control-status {
  font-size: var(--font-size-caption2);
  margin-top: 2px;
}
.status-enabled {
  color: var(--success-color);
}
.status-disabled {
  color: var(--danger-color);
}
.status-locked {
  color: var(--text-color-secondary);
  opacity: 0.6;
}
</style>
