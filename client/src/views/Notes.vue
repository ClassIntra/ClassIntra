<template>
  <div class="notes-page">
    <AppNavBar title="灵感笔记">
      <template slot="actions">
        <button class="nav-action-btn" @click="toggleSidebar" :title="showSidebar ? '收起侧栏' : '展开侧栏'">
          <i class="fa-solid fa-bars"></i>
        </button>
        <button class="nav-action-btn" @click="openResourcePicker" title="从资源仓库导入">
          <i class="fa-solid fa-file-import"></i>
        </button>
        <div class="nav-create-dropdown">
          <button class="nav-action-btn nav-btn-primary" @click="showCreateMenu = !showCreateMenu" title="新建">
            <i class="fa-solid fa-plus"></i>
          </button>
          <transition name="dropdown-fade">
            <div v-if="showCreateMenu" class="create-menu">
              <button class="create-menu-item" @click="createNoteFile(); showCreateMenu = false">
                <i class="fa-regular fa-note-sticky"></i>
                <span>新建笔记</span>
              </button>
              <button class="create-menu-item" @click="createDrawFile(); showCreateMenu = false">
                <i class="fa-solid fa-palette"></i>
                <span>新建画板</span>
              </button>
            </div>
          </transition>
        </div>
        <div class="nav-mode-switch" v-if="!isDrawFile">
          <button
            class="mode-btn"
            :class="{ active: viewMode === 'edit' }"
            @click="viewMode = 'edit'"
            title="编辑模式"
          >
            <i class="fa-solid fa-pen"></i>
          </button>
          <button
            class="mode-btn"
            :class="{ active: viewMode === 'split' }"
            @click="viewMode = 'split'"
            title="分栏模式"
          >
            <i class="fa-solid fa-columns"></i>
          </button>
          <button
            class="mode-btn"
            :class="{ active: viewMode === 'preview' }"
            @click="viewMode = 'preview'"
            title="预览模式"
          >
            <i class="fa-solid fa-eye"></i>
          </button>
        </div>
      </template>
    </AppNavBar>

    <!-- ========== 画板文件：全屏 DrawCanvas ========== -->
    <div class="draw-body" v-if="isDrawFile && activeFile" :key="'draw_' + activeFileId">
      <DrawCanvas
        ref="drawCanvas"
        mode="full"
        :initialLayers="activeFile.canvasData || []"
        @save="onDrawSave"
        @close="exitDrawFile"
      />
    </div>
    <div class="draw-body draw-body--empty" v-else-if="isDrawFile && !activeFile">
      <div class="draw-empty-state">
        <i class="fa-solid fa-palette draw-empty-icon"></i>
        <h3>选择或新建画板文件</h3>
        <p>在左侧选择一个画板文件，或新建一个开始创作</p>
        <button class="btn-primary" @click="createDrawFile">
          <i class="fa-solid fa-plus"></i> 新建画板
        </button>
      </div>
    </div>

    <!-- ========== 笔记文件：正常笔记 UI ========== -->
    <div class="notes-body" v-if="!isDrawFile">
      <transition name="sidebar-slide">
        <div v-if="showSidebar" class="notes-sidebar">
          <div class="sidebar-top">
            <div class="sidebar-search">
              <i class="fa-solid fa-magnifying-glass sidebar-search-icon"></i>
              <input
                v-model="searchQuery"
                type="text"
                placeholder="搜索笔记..."
                class="sidebar-search-input"
              />
            </div>
          </div>

          <div class="folder-bar">
            <select v-model="activeFolder" class="folder-select">
              <option v-for="f in folders" :key="f" :value="f">{{ f }}</option>
            </select>
            <button class="folder-add-btn" @click="addFolder" title="新建文件夹"><i class="fa-solid fa-folder-plus"></i></button>
            <select v-model="sortBy" class="sort-select">
              <option value="updatedAt">按时间</option>
              <option value="title">按标题</option>
              <option value="charCount">按字数</option>
            </select>
          </div>

          <div v-if="tagFilter" class="tag-filter-bar">
            <span class="tag-filter-label">筛选: {{ tagFilter }}</span>
            <button class="tag-filter-clear" @click="tagFilter = ''">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>

          <div class="sidebar-file-list scrollbar-thin">
            <div
              v-for="file in filteredFiles"
              :key="file.id"
              class="file-item"
              :class="{ active: activeFileId === file.id }"
              @click="selectFile(file.id)"
              @contextmenu.prevent="showFileMenu($event, file)"
            >
              <div class="file-item-main">
                <div class="file-item-title">
                  <i v-if="file.type === 'draw'" class="fa-solid fa-palette file-type-icon draw-type" title="画板文件"></i>
                  <i v-else class="fa-regular fa-note-sticky file-type-icon note-type" title="笔记文件"></i>
                  <span v-html="highlightSearch(file.title || '未命名笔记')"></span>
                </div>
                <div class="file-item-meta">
                  <i v-if="file.pinned" class="fa-solid fa-thumbtack file-badge-icon" title="已置顶"></i>
                  <i v-if="file.starred" class="fa-solid fa-star file-badge-icon starred" title="已收藏"></i>
                  <i v-if="file.cloudSynced" class="fa-solid fa-cloud file-badge-icon" :title="file.cloudVisibility === 'public' ? '已同步(公开)' : '已同步(私密)'" :style="{ color: file.cloudVisibility === 'public' ? '#34C759' : '#007AFF' }"></i>
                  <span class="file-item-date">{{ formatDate(file.updatedAt) }}</span>
                </div>
              </div>
              <div v-if="file.tags && file.tags.length" class="file-item-tags">
                <span
                  v-for="tag in file.tags.slice(0, 3)"
                  :key="tag"
                  class="file-tag"
                  @click.stop="tagFilter = tag"
                >{{ tag }}</span>
              </div>
            </div>
            <div v-if="filteredFiles.length === 0" class="sidebar-empty">
              <i class="fa-regular fa-note-sticky"></i>
              <span>{{ searchQuery || tagFilter ? '无匹配笔记' : '暂无笔记' }}</span>
            </div>
          </div>

          <div class="sidebar-bottom">
            <button class="sidebar-paste-btn" @click="pasteFromClipboard" title="从剪贴板粘贴">
              <i class="fa-solid fa-clipboard"></i>
              <span>粘贴创建</span>
            </button>
            <button class="sidebar-paste-btn" @click="showCloudPanel = true" title="云端笔记">
              <i class="fa-solid fa-cloud"></i>
              <span>云端笔记</span>
            </button>
            <button class="privacy-entry" @click="openPrivacySpace">
              <i class="fa-solid fa-lock"></i>
              <span>隐私空间</span>
            </button>
          </div>
        </div>
      </transition>

      <div v-if="sidebarOverlayVisible" class="sidebar-overlay" @click="showSidebar = false"></div>

      <div class="notes-main" :class="{ 'sidebar-collapsed': !showSidebar }">
        <div v-if="activeFile" class="editor-area" :style="editorAreaStyle">
          <div class="editor-header">
            <input
              v-model="activeFile.title"
              class="editor-title-input"
              placeholder="笔记标题"
              @input="onFileChange"
            />
            <div class="editor-title-meta">
              <span class="editor-date">创建于 {{ formatDate(activeFile.createdAt) }}</span>
              <div class="editor-header-actions">
                <button class="editor-tag-btn" @click="showTagModal = true" title="管理标签">
                  <i class="fa-solid fa-tags"></i>
                </button>
                <button class="editor-tag-btn" @click="startAnnotation" title="批注" v-if="(viewMode === 'edit' || viewMode === 'split') && activeFile && activeFile.type !== 'draw'">
                  <i class="fa-solid fa-pen-to-square"></i>
                </button>
                <button class="editor-tag-btn" @click="showVersionHistory = true" title="版本历史">
                  <i class="fa-solid fa-clock-rotate-left"></i>
                </button>
                <button class="editor-tag-btn" @click="uploadToCloud" title="上传到云端" v-if="activeFile && !activeFile.isPrivate" :disabled="cloudSyncing">
                  <i class="fa-solid fa-cloud-arrow-up" :class="{ 'fa-spin': cloudSyncing }"></i>
                </button>
              </div>
            </div>
          </div>

          <div v-if="viewMode !== 'preview'" class="editor-toolbar">
            <button class="toolbar-btn" @click="insertMarkdown('bold')" title="加粗 (Ctrl+B)">
              <i class="fa-solid fa-bold"></i>
            </button>
            <button class="toolbar-btn" @click="insertMarkdown('italic')" title="斜体 (Ctrl+I)">
              <i class="fa-solid fa-italic"></i>
            </button>
            <button class="toolbar-btn" @click="insertMarkdown('strikethrough')" title="删除线">
              <i class="fa-solid fa-strikethrough"></i>
            </button>
            <div class="toolbar-sep"></div>
            <button class="toolbar-btn" @click="insertMarkdown('h1')" title="一级标题">
              <i class="fa-solid fa-heading"></i><span class="toolbar-sub">1</span>
            </button>
            <button class="toolbar-btn" @click="insertMarkdown('h2')" title="二级标题">
              <i class="fa-solid fa-heading"></i><span class="toolbar-sub">2</span>
            </button>
            <button class="toolbar-btn" @click="insertMarkdown('h3')" title="三级标题">
              <i class="fa-solid fa-heading"></i><span class="toolbar-sub">3</span>
            </button>
            <div class="toolbar-sep"></div>
            <button class="toolbar-btn" @click="insertMarkdown('ul')" title="无序列表">
              <i class="fa-solid fa-list-ul"></i>
            </button>
            <button class="toolbar-btn" @click="insertMarkdown('ol')" title="有序列表">
              <i class="fa-solid fa-list-ol"></i>
            </button>
            <button class="toolbar-btn" @click="insertMarkdown('todo')" title="待办事项">
              <i class="fa-solid fa-square-check"></i>
            </button>
            <div class="toolbar-sep"></div>
            <button class="toolbar-btn" @click="insertMarkdown('code')" title="行内代码">
              <i class="fa-solid fa-code"></i>
            </button>
            <button class="toolbar-btn" @click="insertMarkdown('codeblock')" title="代码块">
              <i class="fa-solid fa-file-code"></i>
            </button>
            <button class="toolbar-btn" @click="insertMarkdown('link')" title="链接">
              <i class="fa-solid fa-link"></i>
            </button>
            <button class="toolbar-btn" @click="openCloudImagePicker" title="从云盘插入图片/音视频">
              <i class="fa-solid fa-image"></i>
            </button>
            <button class="toolbar-btn" @click="insertMarkdown('quote')" title="引用">
              <i class="fa-solid fa-quote-left"></i>
            </button>
            <button class="toolbar-btn" @click="insertMarkdown('annotation')" title="批注">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
            <button class="toolbar-btn" @click="insertMarkdown('table')" title="表格">
              <i class="fa-solid fa-table"></i>
            </button>
            <button class="toolbar-btn" @click="insertMarkdown('hr')" title="分割线">
              <i class="fa-solid fa-minus"></i>
            </button>
            <div class="toolbar-sep"></div>
            <button class="toolbar-btn" @click="insertMarkdown('latex-inline')" title="行内公式">
              <span class="toolbar-latex">∑</span>
            </button>
            <button class="toolbar-btn" @click="insertMarkdown('latex-block')" title="块级公式">
              <span class="toolbar-latex">∑∑</span>
            </button>
            <div class="toolbar-sep"></div>
            <button class="toolbar-btn" @click="insertMarkdown('mermaid-flowchart')" title="流程图">
              <i class="fa-solid fa-diagram-project"></i>
            </button>
            <button class="toolbar-btn" @click="insertMarkdown('mermaid-gantt')" title="甘特图">
              <i class="fa-solid fa-bars-staggered"></i>
            </button>
            <button class="toolbar-btn" @click="insertMarkdown('mermaid-mindmap')" title="思维导图">
              <i class="fa-solid fa-sitemap"></i>
            </button>
            <button class="toolbar-btn" @click="insertMarkdown('mermaid-sequence')" title="序列图">
              <i class="fa-solid fa-arrow-right-arrow-left"></i>
            </button>
            <div class="toolbar-sep"></div>
            <button class="toolbar-btn" @click="showCommandPalette = true; commandPaletteQuery = ''" title="命令面板">
              <i class="fa-solid fa-terminal"></i>
            </button>
          </div>

          <div v-if="viewMode !== 'preview'" class="editor-content">
            <textarea
              ref="editor"
              v-model="activeFile.content"
              class="editor-textarea scrollbar-thin"
              :style="{ fontSize: editorFontSize + 'px' }"
              @input="onFileChange"
              @keydown="onEditorKeydown"
              @scroll="syncScroll"
              spellcheck="false"
              placeholder="开始书写你的灵感..."
            ></textarea>
          </div>

          <div v-if="viewMode !== 'preview'" class="editor-footer">
            <span class="footer-stat">中文: {{ chineseCharCount }}</span>
            <span class="footer-stat">英文: {{ englishWordCount }}</span>
            <span class="footer-stat">阅读: {{ readingTime }}</span>
            <span class="footer-stat">字号: {{ editorFontSize }}px</span>
            <span class="footer-stat save-indicator" :class="{ saved: autoSaveIndicator }">
              <i class="fa-solid fa-circle"></i> {{ autoSaveIndicator ? '已保存' : '编辑中' }}
            </span>
          </div>
        </div>

        <div v-else class="editor-empty">
          <div class="empty-icon">
            <i class="fa-regular fa-note-sticky"></i>
          </div>
          <p class="empty-text">选择或创建一个笔记开始书写</p>
          <button class="btn-primary" @click="showTemplatePicker = true">
            <i class="fa-solid fa-plus"></i> 新建笔记
          </button>
        </div>
      <div
        v-if="activeFile && viewMode === 'split'"
        class="editor-resizer"
        @mousedown="startResize"
        @touchstart.prevent="startResize"
      >
        <div class="resizer-line"></div>
      </div>

      <div
        v-if="activeFile && viewMode !== 'edit'"
        class="preview-area"
        :style="previewAreaStyle"
      >
        <div class="preview-header">
          <span class="preview-label">预览</span>
          <button
            v-if="activeFile && activeFile.type !== 'draw'"
            class="preview-anno-toggle"
            :class="{ active: showAnnotationLayer }"
            @click="toggleAnnotationLayer"
            title="在文字上直接批注"
          >
            <i class="fa-solid fa-pen-to-square"></i>
            <span>{{ showAnnotationLayer ? '退出批注' : '批注' }}</span>
          </button>
        </div>
        <!-- 批注输入框 -->
        <div v-if="showAnnotationInput" class="anno-input-bar">
          <input
            id="annotation-inline-input"
            v-model="annotationInput"
            class="anno-input-field"
            placeholder="输入批注内容..."
            @keydown.enter="commitAnnotationCard"
            @keydown.escape="showAnnotationInput = false"
          />
          <button class="btn-primary btn-sm" @click="commitAnnotationCard">添加批注</button>
          <button class="btn-secondary btn-sm" @click="showAnnotationInput = false">取消</button>
        </div>
        <div class="preview-content-wrap">
          <div
            class="preview-content markdown-body scrollbar-thin"
            ref="previewContainer"
            @scroll="syncPreviewScroll"
            @mouseup="onPreviewTextSelect"
            @touchend="onPreviewTextSelect"
          >
            <div class="preview-content-inner">
              <div class="preview-content-html" v-html="renderedContentHtml"></div>
              <!-- 批注涂鸦层：在滚动内容内部，随内容自然滚动 -->
              <div v-if="showAnnotationLayer" class="annotation-overlay" :class="{ 'annotation-active': annoDrawing }">
                <DrawCanvas
                  ref="annotationCanvas"
                  mode="annotation"
                  :key="'anno_' + activeFileId"
                  :initialLayers="activeFile.canvasData || []"
                  @save="onAnnotationSave"
                  @drawing="annoDrawing = $event"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- 结构化批注卡片（在内容下方） -->
        <div v-if="annotationCards.length > 0" class="annotation-cards-section">
          <div class="annotation-cards-label">
            <i class="fa-solid fa-pen-to-square"></i> 批注 ({{ annotationCards.length }})
          </div>
          <div
            v-for="card in annotationCards"
            :key="card.id"
            class="annotation-card"
            :style="{ borderLeftColor: card.color || '#ffc107' }"
          >
            <div class="annotation-card-header">
              <span class="annotation-card-time">{{ formatDate(card.createdAt) }}</span>
              <button class="annotation-card-del" @click="deleteAnnotation(card.id)" title="删除批注">
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div v-if="card.selectedText" class="annotation-card-quote">
              "{{ card.selectedText }}"
            </div>
            <div class="annotation-card-text" v-html="renderAnnotationText(card.text)"></div>
          </div>
        </div>
      </div>
    </div>
  </div>

    <transition name="modal-fade">
      <div v-if="showTemplatePicker" class="modal-overlay" @click.self="showTemplatePicker = false">
        <div class="modal-panel template-modal">
          <div class="modal-header">
            <h3 class="modal-title">
              <i class="fa-solid fa-wand-magic-sparkles"></i> 选择模板
            </h3>
            <button class="modal-close" @click="showTemplatePicker = false">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
          <div class="modal-body">
            <div class="template-grid">
              <div
                v-for="tpl in noteTemplates"
                :key="tpl.id"
                class="template-card"
                @click="createFileFromTemplate(tpl)"
              >
                <div class="template-icon">
                  <i class="fa-solid" :class="tpl.icon"></i>
                </div>
                <div class="template-name">{{ tpl.name }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </transition>

    <transition name="modal-fade">
      <div v-if="showPrivacyModal" class="modal-overlay" @click.self="showPrivacyModal = false">
        <div class="modal-panel privacy-modal">
          <div class="modal-header">
            <h3 class="modal-title">
              <i class="fa-solid fa-lock"></i> 隐私空间
            </h3>
            <button class="modal-close" @click="showPrivacyModal = false">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
          <div v-if="!privacyUnlocked" class="modal-body">
            <p class="privacy-hint">请输入密码以访问隐私空间</p>
            <input
              v-model="privacyPasswordInput"
              type="password"
              class="modal-input"
              placeholder="输入密码"
              @keyup.enter="verifyPrivacyPassword"
              ref="privacyInput"
            />
            <div v-if="!hasPrivacyPassword" class="privacy-setup">
              <p class="privacy-hint">首次使用，请设置密码</p>
              <input
                v-model="privacyPasswordConfirm"
                type="password"
                class="modal-input"
                placeholder="确认密码"
                @keyup.enter="verifyPrivacyPassword"
              />
            </div>
            <button class="btn-primary modal-btn" @click="verifyPrivacyPassword">
              {{ hasPrivacyPassword ? '解锁' : '设置密码' }}
            </button>
          </div>
          <div v-else class="modal-body privacy-content">
            <div class="privacy-toolbar">
              <button class="btn-secondary" @click="createPrivateFile">
                <i class="fa-solid fa-plus"></i> 新建隐私笔记
              </button>
              <button class="btn-secondary" @click="moveToPrivate" :disabled="!activeFile || activeFile.isPrivate">
                <i class="fa-solid fa-lock"></i> 移入隐私
              </button>
              <button class="btn-secondary" @click="moveToPublic" :disabled="!activeFile || !activeFile.isPrivate">
                <i class="fa-solid fa-lock-open"></i> 移出隐私
              </button>
            </div>
            <div class="privacy-file-list">
              <div
                v-for="file in privateFiles"
                :key="file.id"
                class="file-item"
                :class="{ active: activeFileId === file.id }"
                @click="selectFile(file.id)"
              >
                <div class="file-item-main">
                  <div class="file-item-title">{{ file.title || '未命名笔记' }}</div>
                  <div class="file-item-date">{{ formatDate(file.updatedAt) }}</div>
                </div>
              </div>
              <div v-if="privateFiles.length === 0" class="sidebar-empty">
                <span>暂无隐私笔记</span>
              </div>
            </div>
            <button class="btn-secondary modal-btn" @click="lockPrivacySpace">
              <i class="fa-solid fa-lock"></i> 锁定隐私空间
            </button>
          </div>
        </div>
      </div>
    </transition>

    <transition name="modal-fade">
      <div v-if="showTagModal" class="modal-overlay" @click.self="showTagModal = false">
        <div class="modal-panel tag-modal">
          <div class="modal-header">
            <h3 class="modal-title">
              <i class="fa-solid fa-tags"></i> 管理标签
            </h3>
            <button class="modal-close" @click="showTagModal = false">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
          <div class="modal-body">
            <div class="tag-input-row">
              <input
                v-model="newTagInput"
                type="text"
                class="modal-input"
                placeholder="输入标签名"
                @keyup.enter="addTag"
              />
              <button class="btn-primary" @click="addTag">添加</button>
            </div>
            <div class="tag-list">
              <span
                v-for="tag in allTags"
                :key="tag"
                class="tag-item"
                :class="{ active: activeFile && activeFile.tags.indexOf(tag) > -1 }"
                @click="toggleTag(tag)"
              >{{ tag }}</span>
            </div>
            <div v-if="activeFile" class="current-tags">
              <span class="current-tags-label">当前标签:</span>
              <span
                v-for="tag in activeFile.tags"
                :key="tag"
                class="tag-item active"
                @click="removeTag(tag)"
              >{{ tag }} <i class="fa-solid fa-xmark"></i></span>
              <span v-if="activeFile.tags.length === 0" class="no-tags">无标签</span>
            </div>
          </div>
        </div>
      </div>
    </transition>

    <transition name="modal-fade">
      <div v-if="showRenameModal" class="modal-overlay" @click.self="showRenameModal = false">
        <div class="modal-panel">
          <div class="modal-header">
            <h3 class="modal-title">重命名笔记</h3>
            <button class="modal-close" @click="showRenameModal = false">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
          <div class="modal-body">
            <input
              v-model="renameInput"
              type="text"
              class="modal-input"
              placeholder="输入新名称"
              @keyup.enter="confirmRename"
              ref="renameInput"
            />
            <div class="modal-actions">
              <button class="btn-secondary" @click="showRenameModal = false">取消</button>
              <button class="btn-primary" @click="confirmRename">确认</button>
            </div>
          </div>
        </div>
      </div>
    </transition>

    <transition name="modal-fade">
      <div v-if="showFileMenuModal" class="context-menu" :style="fileMenuStyle">
        <button class="context-menu-item" @click="startRename">
          <i class="fa-solid fa-pen"></i> 重命名
        </button>
        <button class="context-menu-item" @click="duplicateFile">
          <i class="fa-solid fa-copy"></i> 复制
        </button>
        <button class="context-menu-item" @click="togglePinFile">
          <i class="fa-solid fa-thumbtack"></i> {{ fileMenuTarget.pinned ? '取消置顶' : '置顶' }}
        </button>
        <button class="context-menu-item" @click="toggleStarFile">
          <i class="fa-solid fa-star"></i> {{ fileMenuTarget.starred ? '取消收藏' : '收藏' }}
        </button>
        <button v-if="!fileMenuTarget.isPrivate" class="context-menu-item" @click="moveToPrivateFromMenu">
          <i class="fa-solid fa-lock"></i> 移入隐私
        </button>
        <button v-if="fileMenuTarget.isPrivate && privacyUnlocked" class="context-menu-item" @click="moveToPublicFromMenu">
          <i class="fa-solid fa-lock-open"></i> 移出隐私
        </button>
        <button class="context-menu-item danger" @click="deleteFileFromMenu">
          <i class="fa-solid fa-trash"></i> 删除
        </button>
      </div>
    </transition>

    <transition name="modal-fade">
      <div v-if="showVersionHistory" class="modal-overlay" @click.self="showVersionHistory = false">
        <div class="modal-panel version-modal">
          <div class="modal-header">
            <h3 class="modal-title">
              <i class="fa-solid fa-clock-rotate-left"></i> 版本历史
            </h3>
            <button class="modal-close" @click="showVersionHistory = false">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
          <div class="modal-body">
            <div v-if="activeFile && activeFile.versions && activeFile.versions.length" class="version-list">
              <div
                v-for="(ver, idx) in activeFile.versions"
                :key="idx"
                class="version-item"
              >
                <div class="version-info">
                  <div class="version-time">{{ formatDate(ver.timestamp) }}</div>
                  <div class="version-summary">{{ (ver.content || '').substring(0, 60) }}{{ (ver.content || '').length > 60 ? '...' : '' }}</div>
                </div>
                <div class="version-actions">
                  <button class="btn-secondary btn-sm" @click="previewVersion(ver)">查看</button>
                  <button class="btn-primary btn-sm" @click="restoreVersion(ver)">恢复</button>
                </div>
              </div>
            </div>
            <div v-else class="sidebar-empty">
              <i class="fa-solid fa-clock-rotate-left"></i>
              <span>暂无版本记录</span>
            </div>
          </div>
        </div>
      </div>
    </transition>

    <transition name="modal-fade">
      <div v-if="showVersionPreview" class="modal-overlay" @click.self="showVersionPreview = false">
        <div class="modal-panel version-preview-modal">
          <div class="modal-header">
            <h3 class="modal-title">
              <i class="fa-solid fa-eye"></i> 版本预览
            </h3>
            <button class="modal-close" @click="showVersionPreview = false">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
          <div class="modal-body">
            <div class="version-preview-content" v-html="versionPreviewHtml"></div>
          </div>
        </div>
      </div>
    </transition>

    <transition name="modal-fade">
      <div v-if="showResourcePicker" class="modal-overlay" @click.self="showResourcePicker = false">
        <div class="modal-panel" style="max-width: 600px; max-height: 80vh;">
          <div class="modal-header">
            <h3 class="modal-title"><i class="fa-solid fa-folder-open"></i> 从资源仓库导入</h3>
            <button class="modal-close" @click="showResourcePicker = false"><i class="fa-solid fa-xmark"></i></button>
          </div>
          <div class="modal-body" style="overflow-y: auto; max-height: 60vh;">
            <div v-if="resourcePickerLoading" class="loading-area" style="padding: 40px; text-align: center;">
              <div class="loading-spinner"></div>
              <span>加载中...</span>
            </div>
            <div v-else-if="resourcePickerItems.length === 0" style="padding: 40px; text-align: center; color: var(--text-tertiary);">
              此目录下没有可导入的文件
            </div>
            <div v-else>
              <div v-if="resourcePickerPath !== '/'" class="resource-picker-item" @click="goResourcePickerBack">
                <i class="fa-solid fa-arrow-left" style="margin-right: 8px;"></i>
                <span>返回上级</span>
              </div>
              <div
                v-for="item in resourcePickerItems"
                :key="item.name"
                class="resource-picker-item"
                :class="{ 'is-dir': item.is_dir }"
                @click="onResourcePickerItemClick(item)"
              >
                <i class="fa-solid" :class="item.is_dir ? 'fa-folder' : getItemIcon(item)" style="margin-right: 10px; width: 20px; text-align: center;"></i>
                <span class="resource-picker-name">{{ item.name }}</span>
                <span v-if="!item.is_dir" class="resource-picker-size">{{ formatFileSize(item.size) }}</span>
              </div>
            </div>
          </div>
          <div class="modal-footer" style="padding: 12px 20px; border-top: 0.5px solid var(--separator-color); display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: var(--font-size-caption); color: var(--text-tertiary);">支持 .txt 和 .md 文件</span>
            <button class="btn-secondary" @click="showResourcePicker = false">取消</button>
          </div>
        </div>
      </div>
    </transition>

    <!-- Interactive Mermaid Zoom Modal -->
    <transition name="modal-fade">
      <div v-if="showMermaidZoom" class="modal-overlay zoom-overlay" @click.self="showMermaidZoom = false">
        <div class="modal-panel mermaid-zoom-panel">
          <div class="modal-header zoom-header">
            <h3 class="modal-title"><i class="fa-solid fa-expand"></i> 图表预览</h3>
            <div class="zoom-controls">
              <button class="zoom-ctrl-btn" @click="zoomIn" title="放大"><i class="fa-solid fa-plus"></i></button>
              <span class="zoom-level">{{ Math.round(mermaidZoomScale * 100) }}%</span>
              <button class="zoom-ctrl-btn" @click="zoomOut" title="缩小"><i class="fa-solid fa-minus"></i></button>
              <button class="zoom-ctrl-btn" @click="resetZoom" title="重置"><i class="fa-solid fa-arrows-to-circle"></i></button>
            </div>
            <button class="modal-close" @click="closeMermaidZoom"><i class="fa-solid fa-xmark"></i></button>
          </div>
          <div
            class="zoom-viewport"
            ref="zoomViewport"
            @wheel.prevent="onZoomWheel"
            @mousedown.prevent="onZoomPanStart"
            @mousemove="onZoomPanMove"
            @mouseup="onZoomPanEnd"
            @mouseleave="onZoomPanEnd"
            @dblclick="resetZoom"
            @touchstart.prevent="onZoomTouchStart"
            @touchmove="onZoomTouchMove"
            @touchend="onZoomTouchEnd"
          >
            <div
              class="zoom-stage"
              :style="{ transform: 'translate(' + mermaidZoomPanX + 'px, ' + mermaidZoomPanY + 'px) scale(' + mermaidZoomScale + ')' }"
            >
              <div class="mermaid-zoom-content" v-html="mermaidZoomContent"></div>
            </div>
          </div>
          <div class="zoom-hint">滚轮缩放 · 拖拽移动 · 双击重置</div>
        </div>
      </div>
    </transition>

    <transition name="modal-fade">
      <div v-if="showChartEditor" class="modal-overlay" @click.self="showChartEditor = false">
        <div class="modal-panel chart-editor-panel">
          <div class="modal-header">
            <h3 class="modal-title"><i class="fa-solid fa-diagram-project"></i> 图表编辑器 - {{ chartEditorType === 'flowchart' ? '流程图' : chartEditorType === 'gantt' ? '甘特图' : chartEditorType === 'mindmap' ? '思维导图' : '序列图' }}</h3>
            <button class="modal-close" @click="showChartEditor = false"><i class="fa-solid fa-xmark"></i></button>
          </div>
          <div class="chart-editor-toolbar">
            <div class="chart-toolbar-group" v-if="chartEditorType === 'flowchart'">
              <button class="chart-tool-btn" @click="chartEditorAddNode('rect')" title="矩形节点"><i class="fa-solid fa-square"></i></button>
              <button class="chart-tool-btn" @click="chartEditorAddNode('round')" title="圆角节点"><i class="fa-regular fa-square"></i></button>
              <button class="chart-tool-btn" @click="chartEditorAddNode('diamond')" title="菱形判断"><i class="fa-solid fa-diamond"></i></button>
              <button class="chart-tool-btn" @click="chartEditorAddNode('circle')" title="圆形节点"><i class="fa-solid fa-circle"></i></button>
              <button class="chart-tool-btn" @click="chartEditorAddEdge" title="添加连线"><i class="fa-solid fa-arrow-right"></i></button>
            </div>
            <div class="chart-toolbar-group" v-if="chartEditorType === 'gantt'">
              <button class="chart-tool-btn" @click="chartEditorAddTask" title="添加任务"><i class="fa-solid fa-plus"></i></button>
              <button class="chart-tool-btn" @click="chartEditorAddMilestone" title="添加里程碑"><i class="fa-solid fa-flag"></i></button>
            </div>
            <div class="chart-toolbar-group" v-if="chartEditorType === 'mindmap'">
              <button class="chart-tool-btn" @click="chartEditorAddBranch" title="添加分支"><i class="fa-solid fa-plus"></i></button>
              <button class="chart-tool-btn" @click="chartEditorAddSubBranch" title="添加子分支"><i class="fa-solid fa-code-branch"></i></button>
            </div>
            <div class="chart-toolbar-group" v-if="chartEditorType === 'sequence'">
              <button class="chart-tool-btn" @click="chartEditorAddParticipant" title="添加参与者"><i class="fa-solid fa-user-plus"></i></button>
              <button class="chart-tool-btn" @click="chartEditorAddMessage" title="添加消息"><i class="fa-solid fa-message"></i></button>
            </div>
            <div class="chart-toolbar-sep"></div>
            <button class="chart-tool-btn" @click="chartEditorAutoLayout" title="自动布局"><i class="fa-solid fa-wand-magic-sparkles"></i></button>
            <button class="chart-tool-btn" @click="chartEditorChangeTheme" title="切换主题"><i class="fa-solid fa-palette"></i></button>
          </div>
          <div class="chart-editor-body">
            <div class="chart-editor-visual">
              <div class="chart-preview-area scrollbar-thin" ref="chartPreviewArea">
                <div v-if="chartEditorPreviewSvg" class="chart-preview-svg" v-html="chartEditorPreviewSvg"></div>
                <div v-if="chartEditorError" class="mermaid-error">{{ chartEditorError }}</div>
                <div v-if="!chartEditorPreviewSvg && !chartEditorError" class="chart-preview-empty">
                  <i class="fa-solid fa-diagram-project"></i>
                  <span>在下方输入Mermaid代码预览图表</span>
                </div>
              </div>
            </div>
            <div class="chart-editor-code">
              <textarea
                v-model="chartEditorCode"
                class="chart-code-textarea scrollbar-thin"
                @input="onChartEditorCodeChange"
                spellcheck="false"
                placeholder="输入 Mermaid 代码..."
              ></textarea>
            </div>
          </div>
          <div class="modal-footer" style="padding: 12px 20px; border-top: 0.5px solid var(--separator-color); display: flex; justify-content: flex-end; gap: 8px;">
            <button class="btn-secondary" @click="showChartEditor = false">取消</button>
            <button class="btn-primary" @click="saveChartToNote">保存到笔记</button>
          </div>
        </div>
      </div>
    </transition>

    <transition name="modal-fade">
      <div v-if="showCommandPalette" class="command-palette-overlay" @click.self="showCommandPalette = false">
        <div class="command-palette">
          <div class="command-palette-input-wrap">
            <i class="fa-solid fa-magnifying-glass command-palette-icon"></i>
            <input
              v-model="commandPaletteQuery"
              class="command-palette-input"
              placeholder="输入命令搜索..."
              ref="commandPaletteInput"
              @keydown.escape="showCommandPalette = false"
              @keydown.enter="executeCommandPalette"
            />
          </div>
          <div class="command-palette-list scrollbar-thin">
            <div
              v-for="(cmd, idx) in filteredCommandItems"
              :key="idx"
              class="command-palette-item"
              @click="executeCommand(cmd)"
            >
              <i class="fa-solid" :class="cmd.icon" style="width: 20px; text-align: center; margin-right: 10px;"></i>
              <span class="command-palette-label">{{ cmd.label }}</span>
              <span v-if="cmd.shortcut" class="command-palette-shortcut">{{ cmd.shortcut }}</span>
            </div>
          </div>
        </div>
      </div>
    </transition>

    <transition name="modal-fade">
      <div v-if="showCloudPanel" class="modal-overlay" @click.self="showCloudPanel = false">
        <div class="modal-panel cloud-panel">
          <div class="modal-header">
            <h3 class="modal-title">
              <i class="fa-solid fa-cloud"></i> 云端笔记
            </h3>
            <button class="modal-close" @click="showCloudPanel = false; viewingCloudNote = null">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
          <div class="modal-body cloud-panel-body">
            <div v-if="!viewingCloudNote">
              <div class="cloud-tabs">
                <button class="cloud-tab-btn" :class="{ active: cloudTab === 'my' }" @click="cloudTab = 'my'">我的云端</button>
                <button class="cloud-tab-btn" :class="{ active: cloudTab === 'public' }" @click="cloudTab = 'public'; loadPublicNotes()">公开笔记</button>
              </div>
              <div v-if="cloudTab === 'my'">
                <div class="cloud-toolbar">
                  <button class="btn-secondary" @click="loadCloudNotes">
                    <i class="fa-solid fa-rotate"></i> 刷新
                  </button>
                  <button class="btn-secondary" @click="showCloudFolderModal = true">
                    <i class="fa-solid fa-folder-plus"></i> 新建文件夹
                  </button>
                </div>
                <div v-if="cloudNotes.length === 0" class="sidebar-empty">
                  <i class="fa-solid fa-cloud"></i>
                  <span>暂无云端笔记</span>
                </div>
                <div v-else class="cloud-note-list">
                  <div
                    v-for="note in cloudNotes"
                    :key="note.id"
                    class="cloud-note-item"
                  >
                    <div class="cloud-note-info" @click="viewCloudNoteDetail(note)">
                      <div class="cloud-note-title">
                        <i v-if="note.is_pinned" class="fa-solid fa-thumbtack" style="font-size: 10px; margin-right: 4px; color: var(--text-tertiary);"></i>
                        {{ note.title || '未命名笔记' }}
                      </div>
                      <div class="cloud-note-meta">
                        <span class="cloud-note-folder"><i class="fa-solid fa-folder" style="margin-right: 3px;"></i>{{ note.folder || '默认' }}</span>
                        <span class="cloud-note-visibility" :class="{ 'is-public': note.visibility === 'public' }">
                          <i class="fa-solid" :class="note.visibility === 'public' ? 'fa-globe' : 'fa-lock'" style="margin-right: 3px;"></i>
                          {{ note.visibility === 'public' ? '公开' : '私密' }}
                        </span>
                        <span class="cloud-note-date">{{ formatDate(note.updated_at) }}</span>
                      </div>
                    </div>
                    <div class="cloud-note-actions">
                      <button class="cloud-action-btn" @click="toggleCloudVisibility(note)" :title="note.visibility === 'public' ? '设为私密' : '设为公开'">
                        <i class="fa-solid" :class="note.visibility === 'public' ? 'fa-lock' : 'fa-globe'"></i>
                      </button>
                      <select class="cloud-folder-select" @change="moveCloudNoteFolder(note.id, $event.target.value)" :value="note.folder || '默认'">
                        <option v-for="f in cloudFolders" :key="f.id" :value="f.name">{{ f.name }}</option>
                        <option value="默认">默认</option>
                      </select>
                      <button class="cloud-action-btn danger" @click="deleteCloudNote(note.id)" title="从云端删除">
                        <i class="fa-solid fa-trash"></i>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              <div v-if="cloudTab === 'public'">
                <div class="cloud-toolbar">
                  <input v-model="publicSearchQuery" type="text" class="modal-input" placeholder="搜索公开笔记..." style="flex:1; margin-right:8px;" />
                  <button class="btn-secondary" @click="loadPublicNotes">
                    <i class="fa-solid fa-rotate"></i> 刷新
                  </button>
                </div>
                <div v-if="publicNotesLoading" class="sidebar-empty">
                  <i class="fa-solid fa-spinner fa-spin"></i>
                  <span>加载中...</span>
                </div>
                <div v-else-if="filteredPublicNotes.length === 0" class="sidebar-empty">
                  <i class="fa-solid fa-globe"></i>
                  <span>暂无公开笔记</span>
                </div>
                <div v-else class="cloud-note-list">
                  <div
                    v-for="note in filteredPublicNotes"
                    :key="note.id"
                    class="cloud-note-item public-note-item"
                    @click="viewCloudNoteDetail(note)"
                  >
                    <div class="cloud-note-info">
                      <div class="cloud-note-title">{{ note.title || '未命名笔记' }}</div>
                      <div class="cloud-note-meta">
                        <span class="cloud-note-author"><i class="fa-solid fa-user" style="margin-right:3px;"></i>{{ note.net_name || '未知用户' }}</span>
                        <span class="cloud-note-folder"><i class="fa-solid fa-folder" style="margin-right: 3px;"></i>{{ note.folder || '默认' }}</span>
                        <span class="cloud-note-date">{{ formatDate(note.updated_at) }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </transition>

    <transition name="modal-fade">
      <div v-if="showCloudFolderModal" class="modal-overlay" @click.self="showCloudFolderModal = false">
        <div class="modal-panel">
          <div class="modal-header">
            <h3 class="modal-title"><i class="fa-solid fa-folder-plus"></i> 新建云端文件夹</h3>
            <button class="modal-close" @click="showCloudFolderModal = false"><i class="fa-solid fa-xmark"></i></button>
          </div>
          <div class="modal-body">
            <input
              v-model="newCloudFolderName"
              type="text"
              class="modal-input"
              placeholder="输入文件夹名称"
              @keyup.enter="createCloudFolder"
            />
            <div class="modal-actions">
              <button class="btn-secondary" @click="showCloudFolderModal = false">取消</button>
              <button class="btn-primary" @click="createCloudFolder">创建</button>
            </div>
          </div>
        </div>
      </div>
    </transition>

    <div v-if="viewingCloudNote" class="cloud-note-fullscreen">
      <div class="cloud-note-fullscreen-header">
        <button class="btn-secondary" @click="viewingCloudNote = null"><i class="fa-solid fa-arrow-left"></i> 返回</button>
        <h2 class="cloud-note-fullscreen-title">{{ viewingCloudNote.title || '未命名笔记' }}</h2>
        <button class="btn-primary" @click="importCloudNote(viewingCloudNote)"><i class="fa-solid fa-download"></i> 转载到本地</button>
      </div>
      <div class="cloud-note-fullscreen-meta">
        <span v-if="viewingCloudNote.net_name"><i class="fa-solid fa-user"></i> {{ viewingCloudNote.net_name }}</span>
        <span v-if="viewingCloudNote.folder"><i class="fa-solid fa-folder"></i> {{ viewingCloudNote.folder }}</span>
        <span v-if="viewingCloudNote.tags && viewingCloudNote.tags.length">
          <i class="fa-solid fa-tags"></i> {{ viewingCloudNote.tags.join(', ') }}
        </span>
        <span><i class="fa-solid fa-clock"></i> {{ formatDate(viewingCloudNote.updated_at) }}</span>
      </div>
      <div class="cloud-note-fullscreen-content markdown-body" v-html="renderMarkdown(viewingCloudNote.content || '')"></div>
    </div>

    <!-- 云盘图片/音视频选择器 -->
    <CloudImagePicker v-if="showCloudPicker" @select="onCloudImageSelect" @close="showCloudPicker = false" />

  </div>
</template>

<script>
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import katex from 'katex';
import mermaid from 'mermaid';
import 'highlight.js/styles/github-dark.min.css';
import 'katex/dist/katex.min.css';
import AppNavBar from '@/components/AppNavBar.vue';
import DrawCanvas from '@/components/DrawCanvas.vue';
import CloudImagePicker from '@/components/CloudImagePicker.vue';
import api from '@/utils/api';
import LatexRenderer from '@/utils/latex-renderer';

var NOTES_STORAGE_KEY = 'notes_data';

mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
  fontFamily: 'inherit',
  suppressErrorRendering: true,
  flowchart: { useMaxWidth: true, htmlLabels: true, curve: 'basis' },
  gantt: { useMaxWidth: true },
  mindmap: { useMaxWidth: true, padding: 16 },
  sequence: { useMaxWidth: true }
});

var mermaidRenderCounter = 0;
var mermaidRenderDebounce = null;

// UTF-8 safe Base64 encode (replaces fragile btoa(unescape(encodeURIComponent(...))))
function utf8ToBase64(str) {
  var bytes = [];
  for (var i = 0; i < str.length; i++) {
    var code = str.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F));
    } else if (code < 0xD800 || code >= 0xE000) {
      bytes.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
    } else {
      // Surrogate pair: code is high surrogate, next is low surrogate
      i++;
      var next = str.charCodeAt(i);
      var cp = 0x10000 + ((code & 0x3FF) << 10) + (next & 0x3FF);
      bytes.push(
        0xF0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3F),
        0x80 | ((cp >> 6) & 0x3F),
        0x80 | (cp & 0x3F)
      );
    }
  }
  var binary = '';
  for (var j = 0; j < bytes.length; j++) {
    binary += String.fromCharCode(bytes[j]);
  }
  return btoa(binary);
}

// UTF-8 safe Base64 decode
function base64ToUtf8(b64) {
  var binary = atob(b64);
  var bytes = [];
  for (var i = 0; i < binary.length; i++) {
    bytes.push(binary.charCodeAt(i));
  }
  var result = '';
  var i = 0;
  while (i < bytes.length) {
    var b0 = bytes[i];
    if (b0 < 0x80) {
      result += String.fromCharCode(b0);
      i += 1;
    } else if ((b0 & 0xE0) === 0xC0) {
      result += String.fromCharCode(((b0 & 0x1F) << 6) | (bytes[i + 1] & 0x3F));
      i += 2;
    } else if ((b0 & 0xF0) === 0xE0) {
      result += String.fromCharCode(((b0 & 0x0F) << 12) | ((bytes[i + 1] & 0x3F) << 6) | (bytes[i + 2] & 0x3F));
      i += 3;
    } else {
      var cp = ((b0 & 0x07) << 18) | ((bytes[i + 1] & 0x3F) << 12) | ((bytes[i + 2] & 0x3F) << 6) | (bytes[i + 3] & 0x3F);
      result += String.fromCharCode(0xD800 + ((cp - 0x10000) >> 10));
      result += String.fromCharCode(0xDC00 + ((cp - 0x10000) & 0x3FF));
      i += 4;
    }
  }
  return result;
}

function encrypt(text, key) {
  var result = '';
  for (var i = 0; i < text.length; i++) {
    result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return utf8ToBase64(result);
}

function decrypt(encoded, key) {
  var text = base64ToUtf8(encoded);
  var result = '';
  for (var i = 0; i < text.length; i++) {
    result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return result;
}

function generateId() {
  return 'note_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

var customRenderer = new marked.Renderer();
customRenderer.code = function(code, lang) {
  var language = lang || '';
  if (language === 'mermaid') {
    mermaidRenderCounter++;
    var mermaidId = 'mermaid-chart-' + mermaidRenderCounter;
    var rawB64 = utf8ToBase64(String(code));
    return '<div class="mermaid-chart-wrapper"><div class="mermaid-chart" id="' + mermaidId + '" data-raw-b64="' + rawB64 + '"></div><div class="mermaid-chart-actions"><button class="mermaid-edit-btn" data-chart-id="' + mermaidId + '" title="编辑图表"><i class="fa-solid fa-pen-to-square"></i></button><button class="mermaid-zoom-btn" data-chart-id="' + mermaidId + '" title="放大查看"><i class="fa-solid fa-expand"></i></button></div></div>';
  }
  var highlighted;
  if (language && hljs.getLanguage(language)) {
    try {
      highlighted = hljs.highlight(code, { language: language }).value;
    } catch (e) {
      highlighted = hljs.highlightAuto(code).value;
    }
  } else {
    highlighted = hljs.highlightAuto(code).value;
  }
  var lines = highlighted.split('\n');
  var lineNumbersHtml = '';
  var codeLinesHtml = '';
  for (var i = 0; i < lines.length; i++) {
    lineNumbersHtml += '<span class="code-line-number">' + (i + 1) + '</span>';
    codeLinesHtml += '<span class="code-line">' + lines[i] + '</span>';
  }
  var langLabel = language ? '<span class="code-lang-label">' + language + '</span>' : '';
  return '<pre class="code-block-wrapper">' + langLabel + '<div class="code-block-inner"><div class="code-line-numbers">' + lineNumbersHtml + '</div><code class="hljs code-block-content">' + codeLinesHtml + '</code></div></pre>';
};
customRenderer.table = function(header, body) {
  return '<div class="table-wrapper"><table class="md-table"><thead>' + header + '</thead><tbody>' + body + '</tbody></table></div>';
};

marked.setOptions({
  renderer: customRenderer,
  breaks: true,
  gfm: true,
  headerIds: false,
  mangle: false
});

var NOTE_TEMPLATES = [
  { id: 'blank', name: '空白笔记', icon: 'fa-file', content: '' },
  { id: 'diary', name: '日记', icon: 'fa-calendar-day', content: '# 📅 日记 - {{date}}\n\n**天气**：\n**心情**：😊\n\n---\n\n## 今日记录\n\n\n\n---\n\n## 今日感悟\n\n' },
  { id: 'meeting', name: '会议记录', icon: 'fa-users', content: '# 📋 会议记录\n\n**日期**：{{date}}\n**参会人**：\n**主持人**：\n\n---\n\n## 议题\n\n1. \n\n## 决议\n\n- \n\n## 待办事项\n\n- [ ] \n\n' },
  { id: 'todo', name: '待办清单', icon: 'fa-list-check', content: '# ✅ 待办清单 - {{date}}\n\n## 🔴 紧急重要\n\n- [ ] \n\n## 🟡 重要不紧急\n\n- [ ] \n\n## 🟢 紧急不重要\n\n- [ ] \n\n## ⚪ 不紧急不重要\n\n- [ ] \n\n---\n\n## 已完成\n\n- [x] \n' },
  { id: 'reading', name: '读书笔记', icon: 'fa-book', content: '# 📖 读书笔记\n\n**书名**：\n**作者**：\n**阅读日期**：{{date}}\n\n---\n\n## 摘要\n\n> \n\n## 核心观点\n\n1. \n\n## 个人感想\n\n\n\n## 精彩段落\n\n> \n\n' },
  { id: 'weekly', name: '周计划', icon: 'fa-calendar-week', content: '# 📅 周计划 - {{date}}\n\n## 周一\n\n- [ ] \n\n## 周二\n\n- [ ] \n\n## 周三\n\n- [ ] \n\n## 周四\n\n- [ ] \n\n## 周五\n\n- [ ] \n\n## 周末\n\n- [ ] \n\n---\n\n## 本周目标\n\n1. \n\n## 本周复盘\n\n\n' }
];

export default {
  name: 'Notes',
  components: { AppNavBar: AppNavBar, DrawCanvas: DrawCanvas, CloudImagePicker: CloudImagePicker },
  data: function() {
    return {
      files: [],
      privateFiles: [],
      activeFileId: null,
      editorFontSize: 15,
      editorWidthPercent: 50,
      viewMode: 'split',
      isResizing: false,
      searchQuery: '',
      tagFilter: '',
      showSidebar: true,
      isMobile: window.innerWidth <= 768,
      showPrivacyModal: false,
      privacyUnlocked: false,
      privacyPasswordInput: '',
      privacyPasswordConfirm: '',
      privacyPassword: '',
      showTagModal: false,
      newTagInput: '',
      showRenameModal: false,
      renameInput: '',
      renameTargetId: null,
      showFileMenuModal: false,
      fileMenuStyle: {},
      fileMenuTarget: {},
      isSyncingScroll: false,
      saveTimer: null,
      autoSaveTimer: null,
      autoSaveIndicator: false,
      showTemplatePicker: false,
      noteTemplates: NOTE_TEMPLATES,
      showVersionHistory: false,
      showVersionPreview: false,
      versionPreviewHtml: '',
      showCreateMenu: false,
      showAnnotationLayer: false,
      annoDrawing: false,
      annotationInput: '',
      annotationSelectedText: '',
      annotationColor: '#ffc107',
      showAnnotationInput: false,
      showResourcePicker: false,
      resourcePickerItems: [],
      resourcePickerPath: '/',
      resourcePickerLoading: false,
      showMermaidZoom: false,
      mermaidZoomContent: '',
      mermaidZoomScale: 1,
      mermaidZoomPanX: 0,
      mermaidZoomPanY: 0,
      mermaidZoomPanning: false,
      mermaidZoomLastX: 0,
      mermaidZoomLastY: 0,
      mermaidZoomTouchDist: 0,
      showChartEditor: false,
      chartEditorCode: '',
      chartEditorType: 'flowchart',
      chartEditorPreviewSvg: '',
      chartEditorError: '',
      showCommandPalette: false,
      commandPaletteQuery: '',
      // 云盘图片选择器
      showCloudPicker: false,
      imageInsertPos: null, // 打开选择器时保存的编辑器光标位置 { start, end }
      folders: ['全部', '默认'],
      activeFolder: '全部',
      sortBy: 'updatedAt',
      renderedContentHtml: '',
      cloudSyncing: false,
      cloudNotes: [],
      showCloudPanel: false,
      cloudFolders: [],
      showCloudFolderModal: false,
      newCloudFolderName: '',
      cloudTab: 'my',
      publicNotes: [],
      publicNotesLoading: false,
      publicSearchQuery: '',
      viewingCloudNote: null
    };
  },
  computed: {
    activeFile: function() {
      var self = this;
      var allFiles = self.allFiles;
      for (var i = 0; i < allFiles.length; i++) {
        if (allFiles[i].id === self.activeFileId) return allFiles[i];
      }
      return null;
    },
    allFiles: function() {
      return this.files.concat(this.privateFiles);
    },
    isDrawFile: function() {
      var file = this.activeFile;
      return file && file.type === 'draw';
    },
    annotationCards: function() {
      var file = this.activeFile;
      if (!file || file.type === 'draw') return [];
      return file.annotations || [];
    },
    filteredFiles: function() {
      var self = this;
      var result = self.files;
      if (self.searchQuery) {
        var q = self.searchQuery.toLowerCase();
        if (q.indexOf('#') === 0) {
          var tagName = q.substring(1);
          result = result.filter(function(f) {
            return f.tags && f.tags.some(function(t) { return t.toLowerCase().indexOf(tagName) > -1; });
          });
        } else {
          result = result.filter(function(f) {
            return (f.title || '').toLowerCase().indexOf(q) > -1 ||
                   (f.content || '').toLowerCase().indexOf(q) > -1;
          });
        }
      }
      if (self.tagFilter) {
        var tf = self.tagFilter;
        result = result.filter(function(f) {
          return f.tags && f.tags.indexOf(tf) > -1;
        });
      }
      if (self.activeFolder && self.activeFolder !== '全部') {
        result = result.filter(function(f) { return (f.folder || '默认') === self.activeFolder; });
      }
      result.sort(function(a, b) {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        if (self.sortBy === 'title') {
          return (a.title || '').localeCompare(b.title || '');
        }
        if (self.sortBy === 'charCount') {
          return ((b.content || '').length) - ((a.content || '').length);
        }
        return new Date(b.updatedAt) - new Date(a.updatedAt);
      });
      return result;
    },
    allTags: function() {
      var self = this;
      var tagSet = {};
      for (var i = 0; i < self.files.length; i++) {
        var tags = self.files[i].tags || [];
        for (var j = 0; j < tags.length; j++) {
          tagSet[tags[j]] = true;
        }
      }
      return Object.keys(tagSet).sort();
    },
    hasPrivacyPassword: function() {
      return !!this.privacyPassword;
    },
    charCount: function() {
      if (!this.activeFile || !this.activeFile.content) return 0;
      return this.activeFile.content.replace(/\s/g, '').length;
    },
    lineCount: function() {
      if (!this.activeFile || !this.activeFile.content) return 0;
      return this.activeFile.content.split('\n').length;
    },
    chineseCharCount: function() {
      if (!this.activeFile || !this.activeFile.content) return 0;
      var match = this.activeFile.content.match(/[\u4e00-\u9fff]/g);
      return match ? match.length : 0;
    },
    englishWordCount: function() {
      if (!this.activeFile || !this.activeFile.content) return 0;
      var match = this.activeFile.content.match(/[a-zA-Z]+/g);
      return match ? match.length : 0;
    },
    readingTime: function() {
      var total = this.chineseCharCount + this.englishWordCount;
      var minutes = Math.ceil(total / 300);
      return minutes < 1 ? '<1分钟' : minutes + '分钟';
    },
    filteredPublicNotes: function() {
      var self = this;
      var q = (self.publicSearchQuery || '').toLowerCase();
      if (!q) return self.publicNotes;
      return self.publicNotes.filter(function(n) {
        return (n.title || '').toLowerCase().indexOf(q) > -1 ||
               (n.content || '').toLowerCase().indexOf(q) > -1 ||
               (n.net_name || '').toLowerCase().indexOf(q) > -1 ||
               (n.tags && n.tags.some(function(t) { return t.toLowerCase().indexOf(q) > -1; }));
      });
    },
    commandItems: function() {
      return [
        { label: '新建笔记', icon: 'fa-plus', action: 'newNote', shortcut: 'Ctrl+N' },
        { label: '保存', icon: 'fa-floppy-disk', action: 'save', shortcut: 'Ctrl+S' },
        { label: '插入流程图', icon: 'fa-diagram-project', action: 'mermaid-flowchart' },
        { label: '插入甘特图', icon: 'fa-bars-staggered', action: 'mermaid-gantt' },
        { label: '插入思维导图', icon: 'fa-sitemap', action: 'mermaid-mindmap' },
        { label: '插入序列图', icon: 'fa-arrow-right-arrow-left', action: 'mermaid-sequence' },
        { label: '加粗', icon: 'fa-bold', action: 'bold', shortcut: 'Ctrl+B' },
        { label: '斜体', icon: 'fa-italic', action: 'italic', shortcut: 'Ctrl+I' },
        { label: '插入代码块', icon: 'fa-file-code', action: 'codeblock' },
        { label: '插入表格', icon: 'fa-table', action: 'table' },
        { label: '增大字号', icon: 'fa-magnifying-glass-plus', action: 'fontSizeUp', shortcut: 'Ctrl+=' },
        { label: '减小字号', icon: 'fa-magnifying-glass-minus', action: 'fontSizeDown', shortcut: 'Ctrl+-' },
        { label: '打开画布', icon: 'fa-paintbrush', action: 'canvas' },
        { label: '管理标签', icon: 'fa-tags', action: 'tags' },
        { label: '版本历史', icon: 'fa-clock-rotate-left', action: 'versions' },
        { label: '焦点模式', icon: 'fa-expand', action: 'focusMode', shortcut: 'Ctrl+Shift+F' }
      ];
    },
    filteredCommandItems: function() {
      var self = this;
      if (!self.commandPaletteQuery) return self.commandItems;
      var q = self.commandPaletteQuery.toLowerCase();
      return self.commandItems.filter(function(cmd) {
        return cmd.label.toLowerCase().indexOf(q) > -1;
      });
    },
    sidebarOverlayVisible: function() {
      return this.isMobile && this.showSidebar;
    },
    editorAreaStyle: function() {
      var self = this;
      if (self.viewMode === 'edit') return { flex: '1 1 0%', minWidth: '0', maxWidth: '100%' };
      if (self.viewMode === 'preview') return { flex: '0 0 0%', overflow: 'hidden', minWidth: '0', maxWidth: '0%' };
      return { flex: '1 1 0%', minWidth: '0', maxWidth: 'calc(' + self.editorWidthPercent + '% - 6px)' };
    },
    previewAreaStyle: function() {
      var self = this;
      if (self.viewMode === 'preview') return { flex: '1 1 0%', minWidth: '0', maxWidth: '100%' };
      if (self.viewMode === 'edit') return { flex: '0 0 0%', overflow: 'hidden', minWidth: '0', maxWidth: '0%' };
      return { flex: '1 1 0%', minWidth: '0', maxWidth: 'calc(' + (100 - self.editorWidthPercent) + '% - 6px)' };
    }
  },
  watch: {
    activeFile: function() {
      var self = this;
      self.$nextTick(function() {
        self.bindTodoClicks();
        self.renderMermaidCharts();
      });
    },
    renderedContentHtml: function() {
      var self = this;
      self._mermaidActionsBound = false;
      self.$nextTick(function() {
        self.bindTodoClicks();
        self.renderMermaidCharts();
        // 内容变化后，若批注层已开启，重新测量并初始化画布尺寸（保留现有图层）
        if (self.showAnnotationLayer && self.$refs.annotationCanvas) {
          self.$refs.annotationCanvas.init(self.activeFile.canvasData || []);
        }
      });
    },
    'activeFile.content': {
      handler: function() {
        var self = this;
        if (self._renderDebounce) clearTimeout(self._renderDebounce);
        self._renderDebounce = setTimeout(function() {
          self.renderedContentHtml = self.computeRenderedContent();
        }, 300);
      },
      immediate: true
    },
    viewMode: function() {
      this.saveData();
    }
  },
  created: function() {
    this.loadData();
    this.loadCloudNotes();
    this.loadCloudFolders();
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onGlobalKeydown);
    window.addEventListener('beforeunload', this.forceSave);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  },
  beforeDestroy: function() {
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onGlobalKeydown);
    window.removeEventListener('beforeunload', this.forceSave);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    if (this._renderDebounce) clearTimeout(this._renderDebounce);
    this.forceSave();
    if (this._activeFileMenuHandler) {
      document.removeEventListener('click', this._activeFileMenuHandler);
      this._activeFileMenuHandler = null;
    }
  },
  methods: {
    renderMarkdown: function(content) {
      if (!content) return '';
      var result = LatexRenderer.processContent(content, marked);
      result.html = DOMPurify.sanitize(result.html, {
        ADD_TAGS: ['math', 'semantics', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'mfrac', 'msqrt', 'mroot', 'mtable', 'mtr', 'mtd', 'munder', 'mover', 'munderover', 'mtext', 'mspace', 'mpadded', 'mphantom', 'mfenced', 'menclose', 'msubsup', 'mmultiscripts', 'maction'],
        ADD_ATTR: ['style', 'displaystyle', 'scriptlevel', 'mathvariant', 'mathsize', 'mathcolor', 'mathbackground', 'linethickness', 'notation', 'open', 'close', 'separators', 'stretchy', 'symmetric', 'lspace', 'rspace', 'largeop', 'movablelimits', 'accent', 'accentunder', 'align', 'columnalign', 'rowalign', 'columnspacing', 'rowspacing', 'columnlines', 'rowlines', 'frame', 'framespacing', 'equalcolumns', 'equalrows', 'minlabelspacing', 'side', 'subscriptshift', 'superscriptshift']
      });
      var html = LatexRenderer.renderFinalHtml(result.html, result.placeholders);
      return html;
    },
    computeRenderedContent: function() {
      if (!this.activeFile || !this.activeFile.content) return '';
      mermaidRenderCounter = 0;
      var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      mermaid.initialize({
        startOnLoad: false,
        theme: isDark ? 'dark' : 'default',
        securityLevel: 'loose',
        fontFamily: 'inherit',
        suppressErrorRendering: true,
        flowchart: { useMaxWidth: true, htmlLabels: true, curve: 'basis' },
        gantt: { useMaxWidth: true },
        mindmap: { useMaxWidth: true, padding: 16 },
        sequence: { useMaxWidth: true }
      });
      var content = this.activeFile.content;
      var result = LatexRenderer.processContent(content, marked);
      var html = DOMPurify.sanitize(result.html, {
        ADD_TAGS: ['math', 'semantics', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'mfrac', 'msqrt', 'mroot', 'mtable', 'mtr', 'mtd', 'munder', 'mover', 'munderover', 'mtext', 'mspace', 'mpadded', 'mphantom', 'mfenced', 'menclose', 'msubsup', 'mmultiscripts', 'maction', 'svg', 'path', 'g', 'text', 'rect', 'circle', 'line', 'polygon', 'polyline', 'ellipse', 'defs', 'clipPath', 'marker', 'tspan', 'foreignObject', 'use', 'image', 'filter', 'feGaussianBlur', 'feOffset', 'feMerge', 'feMergeNode', 'linearGradient', 'stop', 'pattern', 'desc', 'title', 'style'],
        ADD_ATTR: ['style', 'xmlns', 'viewBox', 'preserveAspectRatio', 'd', 'x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'points', 'transform', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'font-size', 'font-family', 'font-weight', 'text-anchor', 'dominant-baseline', 'class', 'id', 'href', 'markerWidth', 'markerHeight', 'refX', 'refY', 'orient', 'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform', 'patternUnits', 'patternTransform', 'filterUnits', 'stdDeviation', 'dx', 'dy', 'result', 'in', 'in2', 'operator', 'k1', 'k2', 'k3', 'k4', 'displaystyle', 'scriptlevel', 'mathvariant', 'mathsize', 'mathcolor', 'mathbackground', 'linethickness', 'notation', 'open', 'close', 'separators', 'stretchy', 'symmetric', 'lspace', 'rspace', 'largeop', 'movablelimits', 'accent', 'accentunder', 'align', 'columnalign', 'rowalign', 'columnspacing', 'rowspacing', 'columnlines', 'rowlines', 'frame', 'framespacing', 'equalcolumns', 'equalrows', 'minlabelspacing', 'side', 'subscriptshift', 'superscriptshift', 'data-raw-b64', 'data-chart-id']
      });
      html = LatexRenderer.renderFinalHtml(html, result.placeholders);
      html = this.renderAnnotations(html);
      html = this.renderTodoItems(html);
      return html;
    },
    loadData: function() {
      var self = this;
      try {
        var raw = localStorage.getItem(NOTES_STORAGE_KEY);
        if (raw) {
          var data = JSON.parse(raw);
          self.files = data.files || [];
          self.privateFiles = data.privateFiles || [];
          self.privacyPassword = data.privatePassword || '';
          self.editorFontSize = data.editorFontSize || 15;
          self.editorWidthPercent = data.editorWidthPercent || 50;
          self.activeFileId = data.activeFileId || null;
          self.viewMode = data.viewMode || 'split';
          self.folders = data.folders || ['全部', '默认'];
          self.activeFolder = data.activeFolder || '全部';
          self.sortBy = data.sortBy || 'updatedAt';
        }
      } catch (e) {}
      self.checkStorageUsage();
    },
    saveData: function() {
      var self = this;
      if (self.saveTimer) clearTimeout(self.saveTimer);
      self.saveTimer = setTimeout(function() {
        try {
          var data = {
            files: self.files,
            privateFiles: self.privateFiles,
            privatePassword: self.privacyPassword,
            editorFontSize: self.editorFontSize,
            editorWidthPercent: self.editorWidthPercent,
            activeFileId: self.activeFileId,
            viewMode: self.viewMode,
            folders: self.folders,
            activeFolder: self.activeFolder,
            sortBy: self.sortBy
          };
          localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(data));
          self._saveCount = (self._saveCount || 0) + 1;
          if (self._saveCount % 10 === 0) self.checkStorageUsage();
        } catch (e) {
          console.error('[Notes] 保存失败:', e);
          if (e.name === 'QuotaExceededError') {
            self.$store.commit('toast/SHOW_TOAST', { message: '存储空间不足，已自动清理旧版本', type: 'warn' });
            self.cleanupOldVersions();
            try { localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(data)); } catch (e2) {}
          }
        }
      }, 300);
    },
    forceSave: function() {
      var self = this;
      if (self.saveTimer) clearTimeout(self.saveTimer);
      if (self.autoSaveTimer) clearTimeout(self.autoSaveTimer);
      try {
        var data = {
          files: self.files,
          privateFiles: self.privateFiles,
          privatePassword: self.privacyPassword,
          editorFontSize: self.editorFontSize,
          editorWidthPercent: self.editorWidthPercent,
          activeFileId: self.activeFileId,
          viewMode: self.viewMode,
          folders: self.folders,
          activeFolder: self.activeFolder,
          sortBy: self.sortBy
        };
        localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(data));
      } catch (e) {
        // beforeunload 中无法弹 toast，静默处理
      }
    },
    handleVisibilityChange: function() {
      if (document.visibilityState === 'hidden') {
        this.forceSave();
      }
    },
    cleanupOldVersions: function() {
      var self = this;
      var allFiles = (self.files || []).concat(self.privateFiles || []);
      var cleaned = false;
      for (var i = 0; i < allFiles.length; i++) {
        var f = allFiles[i];
        if (f.versions && f.versions.length > 5) {
          f.versions = f.versions.slice(f.versions.length - 5);
          cleaned = true;
        }
      }
      return cleaned;
    },
    checkStorageUsage: function() {
      var self = this;
      var total = 0;
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        total += (localStorage.getItem(key) || '').length * 2;
      }
      var limit = 5 * 1024 * 1024;
      var pct = Math.round((total / limit) * 100);
      if (pct > 80 && !self._storageWarned) {
        self._storageWarned = true;
        self.$store.commit('toast/SHOW_TOAST', { message: '存储空间已使用 ' + pct + '%，建议清理旧版本', type: 'warn' });
      } else if (pct <= 70) {
        self._storageWarned = false;
      }
      return { used: total, limit: limit, percent: pct };
    },
    onFileChange: function() {
      var self = this;
      if (self.activeFile) {
        self.activeFile.updatedAt = new Date().toISOString();
      }
      self.autoSaveIndicator = false;
      self.saveData();
      if (self.autoSaveTimer) clearTimeout(self.autoSaveTimer);
      self.autoSaveTimer = setTimeout(function() {
        self.saveVersion();
        self.autoSaveIndicator = true;
        setTimeout(function() {
          self.autoSaveIndicator = false;
        }, 2000);
      }, 2500);
    },
    saveVersion: function() {
      var self = this;
      if (!self.activeFile) return;
      if (!self.activeFile.versions) {
        self.$set(self.activeFile, 'versions', []);
      }
      var now = new Date().toISOString();
      var versions = self.activeFile.versions;
      if (versions.length > 0) {
        var last = versions[versions.length - 1];
        if (last.content === self.activeFile.content && last.title === self.activeFile.title) return;
      }
      versions.push({
        timestamp: now,
        content: self.activeFile.content,
        title: self.activeFile.title
      });
      if (versions.length > 20) {
        self.activeFile.versions = versions.slice(versions.length - 20);
      }
    },
    previewVersion: function(ver) {
      var self = this;
      var content = ver.content || '';
      var result = LatexRenderer.processContent(content, marked);
      var html = DOMPurify.sanitize(result.html, {
        ADD_TAGS: ['math', 'semantics', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'mfrac', 'msqrt', 'mroot', 'mtable', 'mtr', 'mtd', 'munder', 'mover', 'munderover', 'mtext', 'mspace', 'mpadded', 'mphantom', 'mfenced', 'menclose', 'msubsup', 'mmultiscripts', 'maction', 'svg', 'path', 'g', 'text', 'rect', 'circle', 'line', 'polygon', 'polyline', 'ellipse', 'defs', 'clipPath', 'marker', 'tspan', 'foreignObject', 'use', 'image', 'filter', 'feGaussianBlur', 'feOffset', 'feMerge', 'feMergeNode', 'linearGradient', 'stop', 'pattern', 'desc', 'title', 'style'],
        ADD_ATTR: ['style', 'xmlns', 'viewBox', 'preserveAspectRatio', 'd', 'x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'points', 'transform', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'font-size', 'font-family', 'font-weight', 'text-anchor', 'dominant-baseline', 'class', 'id', 'href', 'markerWidth', 'markerHeight', 'refX', 'refY', 'orient', 'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform', 'patternUnits', 'patternTransform', 'filterUnits', 'stdDeviation', 'dx', 'dy', 'result', 'in', 'in2', 'operator', 'k1', 'k2', 'k3', 'k4', 'displaystyle', 'scriptlevel', 'mathvariant', 'mathsize', 'mathcolor', 'mathbackground', 'linethickness', 'notation', 'open', 'close', 'separators', 'stretchy', 'symmetric', 'lspace', 'rspace', 'largeop', 'movablelimits', 'accent', 'accentunder', 'align', 'columnalign', 'rowalign', 'columnspacing', 'rowspacing', 'columnlines', 'rowlines', 'frame', 'framespacing', 'equalcolumns', 'equalrows', 'minlabelspacing', 'side', 'subscriptshift', 'superscriptshift']
      });
      html = LatexRenderer.renderFinalHtml(html, result.placeholders);
      html = self.renderAnnotations(html);
      html = self.renderTodoItems(html);
      self.versionPreviewHtml = html;
      self.showVersionPreview = true;
    },
    restoreVersion: function(ver) {
      var self = this;
      if (!self.activeFile) return;
      self.activeFile.content = ver.content;
      self.activeFile.title = ver.title;
      self.activeFile.updatedAt = new Date().toISOString();
      self.onFileChange();
      self.showVersionHistory = false;
      self.$store.commit('toast/SHOW_TOAST', { message: '已恢复到历史版本', type: 'success' });
    },
    createFile: function() {
      var self = this;
      var file = {
        id: generateId(),
        title: '未命名笔记',
        content: '',
        type: 'note',
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isPrivate: false,
        canvasData: null,
        annotations: [],
        templateId: 'blank',
        versions: []
      };
      self.files.unshift(file);
      self.activeFileId = file.id;
      self.saveData();
      self.$nextTick(function() {
        if (self.$refs.editor) self.$refs.editor.focus();
      });
    },
    createFileFromTemplate: function(tpl) {
      var self = this;
      var now = new Date();
      var dateStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
      var content = tpl.content.replace(/\{\{date\}\}/g, dateStr);
      var file = {
        id: generateId(),
        title: tpl.name + ' - ' + dateStr,
        content: content,
        type: 'note',
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isPrivate: false,
        canvasData: null,
        annotations: [],
        templateId: tpl.id,
        versions: []
      };
      self.files.unshift(file);
      self.activeFileId = file.id;
      self.showTemplatePicker = false;
      self.saveData();
      self.$nextTick(function() {
        if (self.$refs.editor) self.$refs.editor.focus();
      });
    },
    createPrivateFile: function() {
      var self = this;
      var file = {
        id: generateId(),
        title: '未命名隐私笔记',
        content: '',
        type: 'note',
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isPrivate: true,
        canvasData: null,
        annotations: [],
        templateId: 'blank',
        versions: []
      };
      self.privateFiles.unshift(file);
      self.activeFileId = file.id;
      self.saveData();
    },
    selectFile: function(id) {
      var self = this;
      // 切换前自动保存画板数据
      if (self.isDrawFile && self.activeFile && self.activeFile.id !== id && self.$refs.drawCanvas) {
        try {
          var currentData = self.$refs.drawCanvas.getData();
          self.activeFile.canvasData = currentData;
        } catch(e) {}
      }
      // 切换前自动保存批注数据
      if (self.showAnnotationLayer && self.activeFile && self.$refs.annotationCanvas) {
        try {
          var annoData = self.$refs.annotationCanvas.getData();
          self.activeFile.canvasData = annoData;
        } catch(e) {}
      }
      self.activeFileId = id;
      self.saveData();
      if (self.isMobile) self.showSidebar = false;
    },
    deleteFile: function(id) {
      var self = this;
      var idx = self.files.findIndex(function(f) { return f.id === id; });
      if (idx > -1) {
        self.files.splice(idx, 1);
      } else {
        idx = self.privateFiles.findIndex(function(f) { return f.id === id; });
        if (idx > -1) self.privateFiles.splice(idx, 1);
      }
      if (self.activeFileId === id) {
        var remaining = self.files.concat(self.privateFiles);
        self.activeFileId = remaining.length > 0 ? remaining[0].id : null;
      }
      self.saveData();
    },
    startRename: function() {
      var self = this;
      self.renameTargetId = self.fileMenuTarget.id;
      self.renameInput = self.fileMenuTarget.title || '';
      self.showFileMenuModal = false;
      self.showRenameModal = true;
      self.$nextTick(function() {
        if (self.$refs.renameInput) self.$refs.renameInput.focus();
      });
    },
    confirmRename: function() {
      var self = this;
      if (!self.renameInput.trim()) return;
      var file = self.allFiles.find(function(f) { return f.id === self.renameTargetId; });
      if (file) {
        file.title = self.renameInput.trim();
        file.updatedAt = new Date().toISOString();
        self.saveData();
      }
      self.showRenameModal = false;
    },
    duplicateFile: function() {
      var self = this;
      var src = self.fileMenuTarget;
      var copy = {
        id: generateId(),
        title: src.title + ' (副本)',
        content: src.content,
        type: src.type || 'note',
        tags: (src.tags || []).slice(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isPrivate: src.isPrivate,
        canvasData: (src.canvasData || []).slice(),
        annotations: (src.annotations || []).slice(),
        templateId: src.templateId || 'blank',
        versions: []
      };
      if (src.isPrivate) {
        self.privateFiles.unshift(copy);
      } else {
        self.files.unshift(copy);
      }
      self.activeFileId = copy.id;
      self.showFileMenuModal = false;
      self.saveData();
    },
    showFileMenu: function(e, file) {
      var self = this;
      self.fileMenuTarget = file;
      self.fileMenuStyle = {
        left: e.clientX + 'px',
        top: e.clientY + 'px'
      };
      self.showFileMenuModal = true;
      var handler = function() {
        self.showFileMenuModal = false;
        document.removeEventListener('click', handler);
        self._activeFileMenuHandler = null;
      };
      self._activeFileMenuHandler = handler;
      setTimeout(function() {
        document.addEventListener('click', handler);
      }, 0);
    },
    deleteFileFromMenu: function() {
      var self = this;
      self.deleteFile(self.fileMenuTarget.id);
      self.showFileMenuModal = false;
    },
    moveToPrivate: function() {
      var self = this;
      if (!self.activeFile || self.activeFile.isPrivate) return;
      var idx = self.files.findIndex(function(f) { return f.id === self.activeFile.id; });
      if (idx > -1) {
        var file = self.files.splice(idx, 1)[0];
        file.isPrivate = true;
        self.privateFiles.unshift(file);
        self.saveData();
        self.$store.commit('toast/SHOW_TOAST', { message: '已移入隐私空间', type: 'success' });
      }
    },
    moveToPublic: function() {
      var self = this;
      if (!self.activeFile || !self.activeFile.isPrivate) return;
      var idx = self.privateFiles.findIndex(function(f) { return f.id === self.activeFile.id; });
      if (idx > -1) {
        var file = self.privateFiles.splice(idx, 1)[0];
        file.isPrivate = false;
        self.files.unshift(file);
        self.saveData();
        self.$store.commit('toast/SHOW_TOAST', { message: '已移出隐私空间', type: 'success' });
      }
    },
    moveToPrivateFromMenu: function() {
      var self = this;
      var file = self.fileMenuTarget;
      if (file.isPrivate) return;
      var idx = self.files.findIndex(function(f) { return f.id === file.id; });
      if (idx > -1) {
        var moved = self.files.splice(idx, 1)[0];
        moved.isPrivate = true;
        self.privateFiles.unshift(moved);
        self.saveData();
        self.$store.commit('toast/SHOW_TOAST', { message: '已移入隐私空间', type: 'success' });
      }
      self.showFileMenuModal = false;
    },
    moveToPublicFromMenu: function() {
      var self = this;
      var file = self.fileMenuTarget;
      if (!file.isPrivate) return;
      var idx = self.privateFiles.findIndex(function(f) { return f.id === file.id; });
      if (idx > -1) {
        var moved = self.privateFiles.splice(idx, 1)[0];
        moved.isPrivate = false;
        self.files.unshift(moved);
        self.saveData();
        self.$store.commit('toast/SHOW_TOAST', { message: '已移出隐私空间', type: 'success' });
      }
      self.showFileMenuModal = false;
    },
    openPrivacySpace: function() {
      var self = this;
      self.showPrivacyModal = true;
      self.privacyPasswordInput = '';
      self.privacyPasswordConfirm = '';
      self.$nextTick(function() {
        if (self.$refs.privacyInput) self.$refs.privacyInput.focus();
      });
    },
    verifyPrivacyPassword: function() {
      var self = this;
      if (!self.hasPrivacyPassword) {
        if (!self.privacyPasswordInput) return;
        if (self.privacyPasswordInput !== self.privacyPasswordConfirm) {
          self.$store.commit('toast/SHOW_TOAST', { message: '两次密码不一致', type: 'error' });
          return;
        }
        self.privacyPassword = encrypt(self.privacyPasswordInput, 'classnet_notes_key');
        self.privacyUnlocked = true;
        self.saveData();
        self.$store.commit('toast/SHOW_TOAST', { message: '密码设置成功', type: 'success' });
        return;
      }
      var decrypted = decrypt(self.privacyPassword, 'classnet_notes_key');
      if (decrypted === self.privacyPasswordInput) {
        self.privacyUnlocked = true;
        self.$store.commit('toast/SHOW_TOAST', { message: '解锁成功', type: 'success' });
      } else {
        self.$store.commit('toast/SHOW_TOAST', { message: '密码错误', type: 'error' });
      }
    },
    lockPrivacySpace: function() {
      this.privacyUnlocked = false;
      this.showPrivacyModal = false;
      this.$store.commit('toast/SHOW_TOAST', { message: '隐私空间已锁定', type: 'info' });
    },
    addTag: function() {
      var self = this;
      if (!self.newTagInput.trim() || !self.activeFile) return;
      var tag = self.newTagInput.trim();
      if (self.activeFile.tags.indexOf(tag) === -1) {
        self.activeFile.tags.push(tag);
        self.onFileChange();
      }
      self.newTagInput = '';
    },
    removeTag: function(tag) {
      var self = this;
      if (!self.activeFile) return;
      var idx = self.activeFile.tags.indexOf(tag);
      if (idx > -1) {
        self.activeFile.tags.splice(idx, 1);
        self.onFileChange();
      }
    },
    toggleTag: function(tag) {
      var self = this;
      if (!self.activeFile) return;
      var idx = self.activeFile.tags.indexOf(tag);
      if (idx > -1) {
        self.activeFile.tags.splice(idx, 1);
      } else {
        self.activeFile.tags.push(tag);
      }
      self.onFileChange();
    },
    // ============ 云盘图片/音视频插入 ============
    openCloudImagePicker: function() {
      // 打开选择器前保存编辑器光标位置，选择后在该位置插入
      var editor = this.$refs.editor;
      if (editor) {
        this.imageInsertPos = { start: editor.selectionStart, end: editor.selectionEnd };
      }
      this.showCloudPicker = true;
    },
    onCloudImageSelect: function(file) {
      var self = this;
      self.showCloudPicker = false;
      if (!file || !file.name) return;
      // 构造云盘文件访问 URL
      var url = '/api/cloud/files/' + encodeURIComponent(file.name);
      // 按文件类型分支：图片用 ![]()，音视频用 []()（customRenderer.link 渲染播放器）
      var type = self.getCloudFileType(file.name);
      var md = type === 'image' ? '![' + file.name + '](' + url + ')' : '[' + file.name + '](' + url + ')';
      var editor = self.$refs.editor;
      if (!editor) {
        // 兜底：追加到末尾
        self.activeFile.content = (self.activeFile.content || '') + '\n' + md + '\n';
        self.onFileChange();
        return;
      }
      // 在保存的光标位置插入（若未保存则用当前光标）
      var pos = self.imageInsertPos || { start: editor.selectionStart, end: editor.selectionEnd };
      var text = editor.value || '';
      var before = text.substring(0, pos.start);
      var after = text.substring(pos.end);
      var insertText = (before && !before.endsWith('\n') ? '\n' : '') + md + '\n';
      self.activeFile.content = before + insertText + after;
      self.imageInsertPos = null;
      // 恢复编辑器焦点并将光标移到插入内容之后
      self.$nextTick(function() {
        editor.focus();
        var cursorPos = (before + insertText).length;
        editor.setSelectionRange(cursorPos, cursorPos);
      });
      self.onFileChange();
    },
    getCloudFileType: function(name) {
      // 与 CloudImagePicker.getFileType 保持一致的简化版
      var lower = (name || '').toLowerCase();
      if (lower.indexOf('__audio') > -1) return 'audio';
      if (lower.indexOf('__video') > -1) return 'video';
      if (lower.indexOf('__image') > -1) return 'image';
      var VID_EXTS = ['.mp4', '.mov', '.webm', '.mkv', '.avi', '.3gp'];
      var AUD_EXTS = ['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.opus'];
      var IMG_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
      for (var v = 0; v < VID_EXTS.length; v++) { if (lower.indexOf(VID_EXTS[v]) > -1) return 'video'; }
      for (var a = 0; a < AUD_EXTS.length; a++) { if (lower.indexOf(AUD_EXTS[a]) > -1) return 'audio'; }
      for (var i = 0; i < IMG_EXTS.length; i++) { if (lower.indexOf(IMG_EXTS[i]) > -1) return 'image'; }
      return 'other';
    },
    insertMarkdown: function(type) {
      var self = this;
      var editor = self.$refs.editor;
      if (!editor) return;
      var start = editor.selectionStart;
      var end = editor.selectionEnd;
      var text = editor.value;
      var selected = text.substring(start, end);
      var before = text.substring(0, start);
      var after = text.substring(end);
      var insert = '';
      var cursorOffset = 0;

      switch (type) {
        case 'bold':
          insert = '**' + (selected || '粗体文本') + '**';
          cursorOffset = selected ? insert.length : 2;
          break;
        case 'italic':
          insert = '*' + (selected || '斜体文本') + '*';
          cursorOffset = selected ? insert.length : 1;
          break;
        case 'strikethrough':
          insert = '~~' + (selected || '删除线文本') + '~~';
          cursorOffset = selected ? insert.length : 2;
          break;
        case 'h1':
          insert = '\n# ' + (selected || '标题') + '\n';
          cursorOffset = 3;
          break;
        case 'h2':
          insert = '\n## ' + (selected || '标题') + '\n';
          cursorOffset = 4;
          break;
        case 'h3':
          insert = '\n### ' + (selected || '标题') + '\n';
          cursorOffset = 5;
          break;
        case 'ul':
          insert = '\n- ' + (selected || '列表项') + '\n';
          cursorOffset = 3;
          break;
        case 'ol':
          insert = '\n1. ' + (selected || '列表项') + '\n';
          cursorOffset = 4;
          break;
        case 'todo':
          insert = '\n- [ ] ' + (selected || '待办事项') + '\n';
          cursorOffset = 7;
          break;
        case 'code':
          insert = '`' + (selected || '代码') + '`';
          cursorOffset = selected ? insert.length : 1;
          break;
        case 'codeblock':
          insert = '\n```\n' + (selected || '代码内容') + '\n```\n';
          cursorOffset = 5;
          break;
        case 'link':
          insert = '[' + (selected || '链接文本') + '](url)';
          cursorOffset = selected ? insert.length - 1 : 1;
          break;
        case 'image':
          insert = '![' + (selected || '图片描述') + '](url)';
          cursorOffset = selected ? insert.length - 1 : 2;
          break;
        case 'quote':
          insert = '\n> ' + (selected || '引用内容') + '\n';
          cursorOffset = 3;
          break;
        case 'annotation':
          // 使用新的批注卡片系统
          self.addAnnotationCard(selected || '');
          return;
        case 'table':
          insert = '\n| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n';
          cursorOffset = 3;
          break;
        case 'hr':
          insert = '\n---\n';
          cursorOffset = insert.length;
          break;
        case 'latex-inline':
          insert = '$' + (selected || 'x^2') + '$';
          cursorOffset = selected ? insert.length : 1;
          break;
        case 'latex-block':
          insert = '\n$$\n' + (selected || 'x^2') + '\n$$\n';
          cursorOffset = 4;
          break;
        case 'mermaid-flowchart':
          insert = '\n```mermaid\ngraph TD\n    A[开始] --> B{判断}\n    B -->|是| C[执行]\n    B -->|否| D[结束]\n```\n';
          cursorOffset = 19;
          break;
        case 'mermaid-gantt':
          insert = '\n```mermaid\ngantt\n    title 项目计划\n    dateFormat  YYYY-MM-DD\n    section 阶段一\n    需求分析     :a1, 2024-01-01, 5d\n    系统设计     :a2, after a1, 3d\n    section 阶段二\n    开发实现     :b1, after a2, 10d\n    测试验收     :b2, after b1, 5d\n```\n';
          cursorOffset = 19;
          break;
        case 'mermaid-mindmap':
          insert = '\n```mermaid\nmindmap\n  root((中心主题))\n    分支一\n      子主题1\n      子主题2\n    分支二\n      子主题3\n    分支三\n```\n';
          cursorOffset = 19;
          break;
        case 'mermaid-sequence':
          insert = '\n```mermaid\nsequenceDiagram\n    participant A as 参与者A\n    participant B as 参与者B\n    A->>B: 请求\n    B-->>A: 响应\n```\n';
          cursorOffset = 19;
          break;
        default:
          return;
      }

      self.activeFile.content = before + insert + after;
      self.$nextTick(function() {
        var pos = start + cursorOffset;
        editor.setSelectionRange(pos, pos);
        editor.focus();
        self.onFileChange();
      });
    },
    onEditorKeydown: function(e) {
      var self = this;
      if (self.isResizing) return;
      if (e.key === 'Enter') {
        var editor = self.$refs.editor;
        if (!editor) return;
        var pos = editor.selectionStart;
        var text = editor.value;
        var lineStart = text.lastIndexOf('\n', pos - 1) + 1;
        var currentLine = text.substring(lineStart, pos);
        var indent = currentLine.match(/^(\s*)/)[1];
        var listMatch = currentLine.match(/^(\s*)([-*+]|\d+\.)\s/);
        if (listMatch) {
          e.preventDefault();
          var prefix = listMatch[1] + (listMatch[2].match(/\d+/) ? (parseInt(listMatch[2]) + 1) + '. ' : listMatch[2] + ' ');
          var todoMatch = currentLine.match(/^(\s*)([-*+])\s\[[ x]\]\s/);
          if (todoMatch) {
            prefix = todoMatch[1] + todoMatch[2] + ' [ ] ';
          }
          var insert = '\n' + prefix;
          self.activeFile.content = text.substring(0, pos) + insert + text.substring(pos);
          self.$nextTick(function() {
            var newPos = pos + insert.length;
            editor.setSelectionRange(newPos, newPos);
            self.onFileChange();
          });
          return;
        }
        if (indent) {
          e.preventDefault();
          var insertStr = '\n' + indent;
          self.activeFile.content = text.substring(0, pos) + insertStr + text.substring(pos);
          self.$nextTick(function() {
            var newPos = pos + insertStr.length;
            editor.setSelectionRange(newPos, newPos);
            self.onFileChange();
          });
        }
      }
    },
    onGlobalKeydown: function(e) {
      var self = this;
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        self.saveData();
        self.autoSaveIndicator = true;
        setTimeout(function() { self.autoSaveIndicator = false; }, 2000);
        self.$store.commit('toast/SHOW_TOAST', { message: '已保存', type: 'success' });
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        self.showTemplatePicker = true;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        if (self.activeFile) {
          e.preventDefault();
          self.insertMarkdown('bold');
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
        if (self.activeFile) {
          e.preventDefault();
          self.insertMarkdown('italic');
        }
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        self.adjustFontSize(1);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        self.adjustFontSize(-1);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        self.showCommandPalette = true;
        self.commandPaletteQuery = '';
        self.$nextTick(function() {
          if (self.$refs.commandPaletteInput) self.$refs.commandPaletteInput.focus();
        });
      }
      if (e.key === 'Escape') {
        if (self.showCommandPalette) {
          self.showCommandPalette = false;
        }
      }
    },
    adjustFontSize: function(delta) {
      this.editorFontSize = Math.max(12, Math.min(24, this.editorFontSize + delta));
      this.saveData();
    },
    syncScroll: function() {
      var self = this;
      if (self.isSyncingScroll || self.isMobile || self.viewMode !== 'split') return;
      self.isSyncingScroll = true;
      var editor = self.$refs.editor;
      var preview = self.$refs.previewContainer;
      if (editor && preview) {
        var ratio = editor.scrollTop / (editor.scrollHeight - editor.clientHeight || 1);
        preview.scrollTop = ratio * (preview.scrollHeight - preview.clientHeight);
      }
      self.$nextTick(function() {
        self.isSyncingScroll = false;
      });
    },
    syncPreviewScroll: function() {
      var self = this;
      if (self.isSyncingScroll || self.isMobile || self.isResizing || self.viewMode !== 'split') return;
      self.isSyncingScroll = true;
      var editor = self.$refs.editor;
      var preview = self.$refs.previewContainer;
      if (editor && preview) {
        var ratio = preview.scrollTop / (preview.scrollHeight - preview.clientHeight || 1);
        editor.scrollTop = ratio * (editor.scrollHeight - editor.clientHeight);
      }
      self.$nextTick(function() {
        self.isSyncingScroll = false;
      });
    },
    startResize: function(e) {
      var self = this;
      e.preventDefault();
      self.isResizing = true;
      var mainEl = self.$el.querySelector('.notes-main');
      if (!mainEl) return;
      var editorArea = mainEl.querySelector('.editor-area');
      var previewArea = mainEl.querySelector('.preview-area');
      if (editorArea) editorArea.classList.add('resizing');
      if (previewArea) previewArea.classList.add('resizing');
      var isTouch = e.type === 'touchstart';
      var startX = isTouch ? e.touches[0].clientX : e.clientX;
      var startPercent = self.editorWidthPercent;
      var mainWidth = mainEl.offsetWidth;

      function onMove(ev) {
        var cx = isTouch ? ev.touches[0].clientX : ev.clientX;
        var dx = cx - startX;
        var newPercent = startPercent + (dx / mainWidth) * 100;
        if (newPercent < 20) newPercent = 20;
        if (newPercent > 80) newPercent = 80;
        self.editorWidthPercent = newPercent;
      }

      function onEnd() {
        self.isResizing = false;
        if (editorArea) editorArea.classList.remove('resizing');
        if (previewArea) previewArea.classList.remove('resizing');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onEnd);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onEnd);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        self.saveData();
      }

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onEnd);
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onEnd);
    },
    renderAnnotations: function(html) {
      return html.replace(
        /<blockquote>\s*<p>\[批注\]\s*([\s\S]*?)<\/p>\s*<\/blockquote>/g,
        '<div class="note-annotation"><span class="annotation-label">批注</span>$1</div>'
      );
    },
    renderTodoItems: function(html) {
      html = html.replace(
        /<li>\s*\[\s*\]\s*/g,
        '<li class="todo-item"><input type="checkbox" class="todo-checkbox" data-checked="false" /> '
      );
      html = html.replace(
        /<li>\s*\[x\]\s*/gi,
        '<li class="todo-item todo-done"><input type="checkbox" class="todo-checkbox" checked data-checked="true" /> '
      );
      return html;
    },
    bindTodoClicks: function() {
      var self = this;
      var preview = self.$refs.previewContainer;
      if (!preview) return;
      var checkboxes = preview.querySelectorAll('.todo-checkbox');
      for (var i = 0; i < checkboxes.length; i++) {
        checkboxes[i].onclick = function(e) {
          e.preventDefault();
          var isChecked = this.getAttribute('data-checked') === 'true';
          self.toggleTodoItem(!isChecked);
        };
      }
    },
    toggleTodoItem: function(toChecked) {
      var self = this;
      if (!self.activeFile || !self.activeFile.content) return;
      var editor = self.$refs.editor;
      if (!editor) return;
      var pos = editor.selectionStart;
      var lines = self.activeFile.content.split('\n');
      var charCount = 0;
      var targetLine = -1;
      for (var i = 0; i < lines.length; i++) {
        var lineLen = lines[i].length + 1;
        if (charCount <= pos && pos < charCount + lineLen) {
          targetLine = i;
          break;
        }
        charCount += lineLen;
      }
      if (targetLine === -1) {
        for (var j = 0; j < lines.length; j++) {
          if (toChecked && lines[j].match(/^- \[ \] /)) {
            lines[j] = lines[j].replace(/^- \[ \] /, '- [x] ');
            targetLine = j;
            break;
          } else if (!toChecked && lines[j].match(/^- \[x\] /i)) {
            lines[j] = lines[j].replace(/^- \[x\] /i, '- [ ] ');
            targetLine = j;
            break;
          }
        }
      } else {
        if (toChecked) {
          lines[targetLine] = lines[targetLine].replace(/^- \[ \] /, '- [x] ');
        } else {
          lines[targetLine] = lines[targetLine].replace(/^- \[x\] /i, '- [ ] ');
        }
      }
      self.activeFile.content = lines.join('\n');
      self.onFileChange();
    },
    openResourcePicker: function() {
      var self = this;
      self.showResourcePicker = true;
      self.resourcePickerPath = '/';
      self.loadResourcePickerItems('/');
    },
    loadResourcePickerItems: function(dirPath) {
      var self = this;
      self.resourcePickerLoading = true;
      api.get('/resources', { params: { path: dirPath === '/' ? '' : dirPath } })
        .then(function(response) {
          self.resourcePickerItems = response.data.data.files || [];
          self.resourcePickerLoading = false;
        })
        .catch(function() {
          self.$store.commit('toast/SHOW_TOAST', { message: '加载资源仓库失败', type: 'error' });
          self.resourcePickerLoading = false;
        });
    },
    onResourcePickerItemClick: function(item) {
      var self = this;
      if (item.is_dir) {
        var newPath = self.resourcePickerPath === '/' ? item.name : self.resourcePickerPath + '/' + item.name;
        self.resourcePickerPath = newPath;
        self.loadResourcePickerItems(newPath);
        return;
      }
      var ext = (item.extension || '').toLowerCase();
      if (ext !== 'txt' && ext !== 'md') {
        self.$store.commit('toast/SHOW_TOAST', { message: '仅支持导入 .txt 和 .md 文件', type: 'warning' });
        return;
      }
      var filePath = self.resourcePickerPath === '/' ? item.name : self.resourcePickerPath + '/' + item.name;
      api.get('/resources/preview', { params: { path: filePath } })
        .then(function(response) {
          var content = response.data.data.content || '';
          var newFile = {
            id: generateId(),
            title: item.name.replace(/\.(txt|md)$/i, ''),
            content: content,
            tags: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            isPrivate: false,
            canvasData: [],
            templateId: 'blank',
            versions: []
          };
          self.files.unshift(newFile);
          self.activeFileId = newFile.id;
          self.saveData();
          self.showResourcePicker = false;
          self.$store.commit('toast/SHOW_TOAST', { message: '导入成功: ' + item.name, type: 'success' });
        })
        .catch(function() {
          self.$store.commit('toast/SHOW_TOAST', { message: '读取文件失败', type: 'error' });
        });
    },
    goResourcePickerBack: function() {
      var self = this;
      var parts = self.resourcePickerPath.split('/');
      parts.pop();
      var parentPath = parts.join('/') || '/';
      self.resourcePickerPath = parentPath;
      self.loadResourcePickerItems(parentPath);
    },
    getItemIcon: function(item) {
      var ext = (item.extension || '').toLowerCase();
      if (ext === 'md' || ext === 'markdown') return 'fa-file-lines';
      if (ext === 'txt') return 'fa-file-alt';
      return 'fa-file';
    },
    formatFileSize: function(bytes) {
      if (!bytes) return '';
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    },
    pasteFromClipboard: function() {
      var self = this;
      if (navigator.clipboard && window.isSecureContext && navigator.clipboard.readText) {
        navigator.clipboard.readText().then(function(text) {
          if (!text) {
            self.$store.commit('toast/SHOW_TOAST', { message: '剪贴板为空', type: 'error' });
            return;
          }
          var newFile = {
            id: generateId(),
            title: '粘贴笔记 - ' + new Date().toLocaleDateString(),
            content: text,
            tags: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            isPrivate: false,
            canvasData: [],
            templateId: 'blank',
            versions: []
          };
          self.files.unshift(newFile);
          self.activeFileId = newFile.id;
          self.saveData();
          self.$store.commit('toast/SHOW_TOAST', { message: '已从剪贴板创建笔记', type: 'success' });
        }).catch(function() {
          self.$store.commit('toast/SHOW_TOAST', { message: '无法读取剪贴板', type: 'error' });
        });
      } else {
        self.$store.commit('toast/SHOW_TOAST', { message: '浏览器不支持剪贴板读取', type: 'error' });
      }
    },
    highlightSearch: function(text) {
      var self = this;
      if (!self.searchQuery || self.searchQuery.indexOf('#') === 0) {
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }
      var q = self.searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      var regex = new RegExp('(' + q + ')', 'gi');
      return escaped.replace(regex, '<mark class="search-highlight">$1</mark>');
    },
    formatDate: function(dateStr) {
      if (!dateStr) return '';
      var d = new Date(dateStr);
      var now = new Date();
      var diff = now - d;
      if (diff < 60000) return '刚刚';
      if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
      if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
      if (diff < 604800000) return Math.floor(diff / 86400000) + '天前';
      var month = d.getMonth() + 1;
      var day = d.getDate();
      var hours = d.getHours().toString().padStart(2, '0');
      var minutes = d.getMinutes().toString().padStart(2, '0');
      return month + '/' + day + ' ' + hours + ':' + minutes;
    },
    toggleSidebar: function() {
      this.showSidebar = !this.showSidebar;
    },
    onResize: function() {
      this.isMobile = window.innerWidth <= 768;
    },
    renderMermaidCharts: function(retryCount) {
      var self = this;
      if (mermaidRenderDebounce) clearTimeout(mermaidRenderDebounce);
      var attempt = retryCount || 0;
      mermaidRenderDebounce = setTimeout(function() {
        var preview = self.$refs.previewContainer;
        if (!preview) {
          if (attempt < 5) {
            self.renderMermaidCharts(attempt + 1);
          }
          return;
        }
        var charts = preview.querySelectorAll('.mermaid-chart');
        if (charts.length === 0) {
          self.bindMermaidChartActions();
          return;
        }
        var renderQueue = [];
        charts.forEach(function(el) {
          var rawB64 = el.getAttribute('data-raw-b64');
          if (!rawB64) {
            if (!el.querySelector('svg') && !el.querySelector('.mermaid-error')) {
              var chartId = el.id;
              if (chartId) {
                var idx = parseInt(chartId.replace('mermaid-chart-', ''), 10);
                var rawCode = self.extractMermaidCodeFromContent(idx);
                if (rawCode) {
                  rawB64 = utf8ToBase64(rawCode);
                  el.setAttribute('data-raw-b64', rawB64);
                }
              }
            }
          }
          if (!rawB64) return;
          var decodedCode;
          try {
            decodedCode = base64ToUtf8(rawB64);
          } catch (e) {
            try { decodedCode = atob(rawB64); } catch (e2) { return; }
          }
          var chartId = el.id;
          renderQueue.push({ el: el, code: decodedCode, id: chartId });
        });
        if (renderQueue.length === 0) {
          self.bindMermaidChartActions();
          return;
        }
        var idx = 0;
        function renderNext() {
          if (idx >= renderQueue.length) {
            self.$nextTick(function() {
              self.bindMermaidChartActions();
            });
            return;
          }
          var item = renderQueue[idx];
          idx++;
          var svgId = item.id + '-svg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);

          // Pre-validate syntax with mermaid.parse() before attempting render
          try {
            mermaid.parse(item.code);
          } catch (parseErr) {
            var parseMsg = parseErr.message || String(parseErr);
            console.warn('[Mermaid] Parse error:', parseMsg);
            item.el.innerHTML = '<div class="mermaid-error"><i class="fa-solid fa-triangle-exclamation"></i> 语法错误<div class="mermaid-error-code"><pre>' + parseMsg.replace(/</g, '&lt;').replace(/\n/g, '<br>') + '</pre></div></div>';
            item.el.removeAttribute('data-raw-b64');
            renderNext();
            return;
          }

          try {
            var renderResult = mermaid.render(svgId, item.code);
            if (renderResult && typeof renderResult.then === 'function') {
              renderResult.then(function(result) {
                if (result && result.svg) {
                  item.el.innerHTML = result.svg;
                  var svg = item.el.querySelector('svg');
                  if (svg) {
                    svg.style.maxWidth = '100%';
                    svg.style.height = 'auto';
                  }
                } else {
                  item.el.innerHTML = '<div class="mermaid-error"><i class="fa-solid fa-triangle-exclamation"></i> 图表渲染结果为空</div>';
                }
                item.el.removeAttribute('data-raw-b64');
                renderNext();
              }).catch(function(err) {
                var errMsg = (err && (err.message || String(err))) || '未知错误';
                console.warn('[Mermaid] Render error:', errMsg);
                item.el.innerHTML = '<div class="mermaid-error"><i class="fa-solid fa-triangle-exclamation"></i> 图表渲染失败<div class="mermaid-error-code"><pre>' + errMsg.replace(/</g, '&lt;').replace(/\n/g, '<br>') + '</pre></div></div>';
                item.el.removeAttribute('data-raw-b64');
                renderNext();
              });
            } else if (renderResult && renderResult.svg) {
              // Synchronous result (fallback for older Mermaid)
              item.el.innerHTML = renderResult.svg;
              item.el.removeAttribute('data-raw-b64');
              var svg = item.el.querySelector('svg');
              if (svg) {
                svg.style.maxWidth = '100%';
                svg.style.height = 'auto';
              }
              renderNext();
            } else {
              // No valid result
              item.el.innerHTML = '<div class="mermaid-error"><i class="fa-solid fa-triangle-exclamation"></i> 图表渲染结果异常</div>';
              item.el.removeAttribute('data-raw-b64');
              renderNext();
            }
          } catch (e) {
            var errMsg = (e && (e.message || String(e))) || '未知异常';
            console.warn('[Mermaid] Render exception:', errMsg);
            item.el.innerHTML = '<div class="mermaid-error"><i class="fa-solid fa-triangle-exclamation"></i> 图表渲染失败<div class="mermaid-error-code"><pre>' + errMsg.replace(/</g, '&lt;').replace(/\n/g, '<br>') + '</pre></div></div>';
            item.el.removeAttribute('data-raw-b64');
            renderNext();
          }
        }
        renderNext();
      }, 150);
    },
    bindMermaidChartActions: function() {
      var self = this;
      var preview = self.$refs.previewContainer;
      if (!preview) return;
      if (self._mermaidActionsBound) return;
      self._mermaidActionsBound = true;
      preview.addEventListener('click', function(e) {
        var btn = e.target.closest('.mermaid-edit-btn');
        if (btn) {
          var chartId = btn.getAttribute('data-chart-id');
          var chartEl = document.getElementById(chartId);
          if (chartEl) {
            var rawB64 = chartEl.getAttribute('data-raw-b64');
            var rawCode = '';
            if (rawB64) {
              try {
                rawCode = base64ToUtf8(rawB64);
              } catch (e2) {
                try { rawCode = atob(rawB64); } catch (e3) { rawCode = ''; }
              }
            }
            if (!rawCode) {
              var idx = parseInt(chartId.replace('mermaid-chart-', ''), 10);
              rawCode = self.extractMermaidCodeFromContent(idx);
            }
            self.openChartEditor(rawCode);
          }
          return;
        }
        var zoomBtn = e.target.closest('.mermaid-zoom-btn');
        if (zoomBtn) {
          var chartId2 = zoomBtn.getAttribute('data-chart-id');
          var chartEl2 = document.getElementById(chartId2);
          if (chartEl2) {
            self.zoomMermaidChart(chartEl2);
          }
          return;
        }
      });
    },
    extractMermaidCodeFromContent: function(chartIndex) {
      var self = this;
      if (!self.activeFile || !self.activeFile.content) return '';
      var content = self.activeFile.content;
      var regex = /```mermaid\n([\s\S]*?)```/g;
      var match;
      var count = 0;
      while ((match = regex.exec(content)) !== null) {
        count++;
        if (count === chartIndex) {
          return match[1].trim();
        }
      }
      return '';
    },
    zoomMermaidChart: function(chartEl) {
      var self = this;
      var svgHtml = chartEl.innerHTML;
      self.mermaidZoomContent = svgHtml;
      self.mermaidZoomScale = 1;
      self.mermaidZoomPanX = 0;
      self.mermaidZoomPanY = 0;
      self.showMermaidZoom = true;
      self.$nextTick(function() {
        self.fitZoomToViewport();
      });
    },
    closeMermaidZoom: function() {
      this.showMermaidZoom = false;
      this.mermaidZoomContent = '';
    },
    // Fit the SVG to the viewport on open
    fitZoomToViewport: function() {
      var self = this;
      var viewport = self.$refs.zoomViewport;
      if (!viewport) return;
      var svg = viewport.querySelector('svg');
      if (!svg) return;
      var vw = viewport.clientWidth;
      var vh = viewport.clientHeight;
      var sw = svg.getAttribute('width') ? parseFloat(svg.getAttribute('width')) : (svg.viewBox && svg.viewBox.baseVal ? svg.viewBox.baseVal.width : vw);
      var sh = svg.getAttribute('height') ? parseFloat(svg.getAttribute('height')) : (svg.viewBox && svg.viewBox.baseVal ? svg.viewBox.baseVal.height : vh);
      if (!sw || !sh || sw <= 0 || sh <= 0) return;
      var scaleX = (vw - 80) / sw;
      var scaleY = (vh - 80) / sh;
      var fitScale = Math.min(scaleX, scaleY, 2);
      if (fitScale < 0.3) fitScale = 0.3;
      self.mermaidZoomScale = fitScale;
      self.mermaidZoomPanX = 0;
      self.mermaidZoomPanY = 0;
    },
    zoomIn: function() {
      this.mermaidZoomScale = Math.min(5, this.mermaidZoomScale * 1.25);
    },
    zoomOut: function() {
      this.mermaidZoomScale = Math.max(0.2, this.mermaidZoomScale / 1.25);
    },
    resetZoom: function() {
      this.mermaidZoomScale = 1;
      this.mermaidZoomPanX = 0;
      this.mermaidZoomPanY = 0;
    },
    onZoomWheel: function(e) {
      var delta = e.deltaY > 0 ? -0.1 : 0.1;
      var newScale = Math.max(0.2, Math.min(5, this.mermaidZoomScale + delta));
      // Zoom toward cursor position
      var viewport = this.$refs.zoomViewport;
      if (viewport) {
        var rect = viewport.getBoundingClientRect();
        var mx = e.clientX - rect.left;
        var my = e.clientY - rect.top;
        var ratio = newScale / this.mermaidZoomScale;
        this.mermaidZoomPanX = mx - ratio * (mx - this.mermaidZoomPanX);
        this.mermaidZoomPanY = my - ratio * (my - this.mermaidZoomPanY);
      }
      this.mermaidZoomScale = newScale;
    },
    onZoomPanStart: function(e) {
      this.mermaidZoomPanning = true;
      this.mermaidZoomLastX = e.clientX;
      this.mermaidZoomLastY = e.clientY;
    },
    onZoomPanMove: function(e) {
      if (!this.mermaidZoomPanning) return;
      var dx = e.clientX - this.mermaidZoomLastX;
      var dy = e.clientY - this.mermaidZoomLastY;
      this.mermaidZoomPanX += dx;
      this.mermaidZoomPanY += dy;
      this.mermaidZoomLastX = e.clientX;
      this.mermaidZoomLastY = e.clientY;
    },
    onZoomPanEnd: function() {
      this.mermaidZoomPanning = false;
    },
    onZoomTouchStart: function(e) {
      if (e.touches.length === 1) {
        this.mermaidZoomPanning = true;
        this.mermaidZoomLastX = e.touches[0].clientX;
        this.mermaidZoomLastY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        this.mermaidZoomPanning = false;
        var dx = e.touches[0].clientX - e.touches[1].clientX;
        var dy = e.touches[0].clientY - e.touches[1].clientY;
        this.mermaidZoomTouchDist = Math.sqrt(dx * dx + dy * dy);
      }
    },
    onZoomTouchMove: function(e) {
      if (e.touches.length === 1 && this.mermaidZoomPanning) {
        var dx = e.touches[0].clientX - this.mermaidZoomLastX;
        var dy = e.touches[0].clientY - this.mermaidZoomLastY;
        this.mermaidZoomPanX += dx;
        this.mermaidZoomPanY += dy;
        this.mermaidZoomLastX = e.touches[0].clientX;
        this.mermaidZoomLastY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        var dx2 = e.touches[0].clientX - e.touches[1].clientX;
        var dy2 = e.touches[0].clientY - e.touches[1].clientY;
        var newDist = Math.sqrt(dx2 * dx2 + dy2 * dy2);
        if (this.mermaidZoomTouchDist > 0) {
          var scale = newDist / this.mermaidZoomTouchDist;
          this.mermaidZoomScale = Math.max(0.2, Math.min(5, this.mermaidZoomScale * scale));
        }
        this.mermaidZoomTouchDist = newDist;
      }
    },
    onZoomTouchEnd: function() {
      this.mermaidZoomPanning = false;
      this.mermaidZoomTouchDist = 0;
    },
    openChartEditor: function(rawCode) {
      var self = this;
      self.chartEditorCode = rawCode;
      self.showChartEditor = true;
      self.detectChartType(rawCode);
      self.$nextTick(function() {
        self.renderChartPreview();
      });
    },
    detectChartType: function(code) {
      var self = this;
      var trimmed = code.trim();
      if (trimmed.match(/^(graph|flowchart)\s/i)) {
        self.chartEditorType = 'flowchart';
      } else if (trimmed.match(/^gantt/i)) {
        self.chartEditorType = 'gantt';
      } else if (trimmed.match(/^mindmap/i)) {
        self.chartEditorType = 'mindmap';
      } else if (trimmed.match(/^sequenceDiagram/i)) {
        self.chartEditorType = 'sequence';
      } else {
        self.chartEditorType = 'flowchart';
      }
    },
    onChartEditorCodeChange: function() {
      var self = this;
      self.detectChartType(self.chartEditorCode);
      if (self._chartPreviewTimer) clearTimeout(self._chartPreviewTimer);
      self._chartPreviewTimer = setTimeout(function() {
        self.renderChartPreview();
      }, 300);
    },
    renderChartPreview: function() {
      var self = this;
      var code = self.chartEditorCode.trim();
      if (!code) {
        self.chartEditorPreviewSvg = '';
        self.chartEditorError = '';
        return;
      }
      var tempId = 'chart-preview-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
      try {
        mermaid.render(tempId, code).then(function(result) {
          self.chartEditorPreviewSvg = result.svg;
          self.chartEditorError = '';
        }).catch(function(err) {
          self.chartEditorError = '语法错误: ' + (err.message || '请检查Mermaid代码');
          self.chartEditorPreviewSvg = '';
        });
      } catch (e) {
        self.chartEditorError = '语法错误: ' + (e.message || '请检查Mermaid代码');
        self.chartEditorPreviewSvg = '';
      }
    },
    saveChartToNote: function() {
      var self = this;
      if (!self.activeFile) return;
      var editor = self.$refs.editor;
      if (!editor) return;
      var codeBlock = '\n```mermaid\n' + self.chartEditorCode + '\n```\n';
      var pos = editor.selectionStart;
      var text = self.activeFile.content;
      self.activeFile.content = text.substring(0, pos) + codeBlock + text.substring(pos);
      self.showChartEditor = false;
      self.onFileChange();
      self.$store.commit('toast/SHOW_TOAST', { message: '图表已插入笔记', type: 'success' });
    },
    chartEditorAddNode: function(type) {
      var self = this;
      var nodeId = 'N' + Date.now().toString(36);
      var suffix = '';
      if (type === 'rect') suffix = nodeId + '[新节点]';
      else if (type === 'round') suffix = nodeId + '(新节点)';
      else if (type === 'diamond') suffix = nodeId + '{新判断}';
      else if (type === 'circle') suffix = nodeId + '((新节点))';
      var lines = self.chartEditorCode.split('\n');
      var lastNodeLine = -1;
      for (var i = lines.length - 1; i >= 0; i--) {
        if (lines[i].trim().match(/^[A-Za-z0-9_]+[\[\(\{]/)) {
          lastNodeLine = i;
          break;
        }
      }
      if (lastNodeLine >= 0) {
        var lastNodeId = lines[lastNodeLine].trim().match(/^([A-Za-z0-9_]+)/);
        if (lastNodeId) {
          suffix = lastNodeId[1] + ' --> ' + suffix;
        }
      }
      self.chartEditorCode += '\n    ' + suffix;
      self.renderChartPreview();
    },
    chartEditorAddEdge: function() {
      var self = this;
      var lines = self.chartEditorCode.split('\n');
      var nodeIds = [];
      lines.forEach(function(line) {
        var m = line.trim().match(/^([A-Za-z0-9_]+)[\[\(\{]/);
        if (m) nodeIds.push(m[1]);
      });
      if (nodeIds.length < 2) {
        self.$store.commit('toast/SHOW_TOAST', { message: '至少需要2个节点才能连线', type: 'warning' });
        return;
      }
      var from = nodeIds[nodeIds.length - 2];
      var to = nodeIds[nodeIds.length - 1];
      self.chartEditorCode += '\n    ' + from + ' --> ' + to;
      self.renderChartPreview();
    },
    chartEditorAddMilestone: function() {
      var self = this;
      var taskId = 'ms' + Date.now().toString(36);
      self.chartEditorCode += '\n    里程碑     :milestone,' + taskId + ', 2024-01-15, 0d';
      self.renderChartPreview();
    },
    chartEditorAddSubBranch: function() {
      var self = this;
      self.chartEditorCode += '\n        子分支';
      self.renderChartPreview();
    },
    chartEditorAddParticipant: function() {
      var self = this;
      var pId = 'P' + Date.now().toString(36);
      var lines = self.chartEditorCode.split('\n');
      var insertIdx = 0;
      for (var i = 0; i < lines.length; i++) {
        if (lines[i].trim().indexOf('participant') === 0) insertIdx = i + 1;
      }
      lines.splice(insertIdx, 0, '    participant ' + pId + ' as 参与者' + (insertIdx + 1));
      self.chartEditorCode = lines.join('\n');
      self.renderChartPreview();
    },
    chartEditorAddMessage: function() {
      var self = this;
      self.chartEditorCode += '\n    A->>B: 新消息';
      self.renderChartPreview();
    },
    chartEditorChangeTheme: function() {
      var self = this;
      var themes = ['default', 'dark', 'forest', 'neutral'];
      var currentIdx = themes.indexOf(mermaid.mermaidAPI.getConfig().theme || 'default');
      var nextIdx = (currentIdx + 1) % themes.length;
      mermaid.initialize({ theme: themes[nextIdx] });
      self.renderChartPreview();
      self.$store.commit('toast/SHOW_TOAST', { message: '主题已切换为: ' + themes[nextIdx], type: 'info' });
    },
    chartEditorAddTask: function() {
      var self = this;
      var taskId = 'task' + Date.now().toString(36);
      self.chartEditorCode += '\n    新任务     :' + taskId + ', 2024-01-01, 3d';
      self.renderChartPreview();
    },
    chartEditorAddBranch: function() {
      var self = this;
      self.chartEditorCode += '\n      新分支';
      self.renderChartPreview();
    },
    chartEditorAutoLayout: function() {
      var self = this;
      self.renderChartPreview();
      self.$store.commit('toast/SHOW_TOAST', { message: '已重新渲染布局', type: 'info' });
    },
    executeCommand: function(cmd) {
      var self = this;
      self.showCommandPalette = false;
      switch (cmd.action) {
        case 'newNote': self.showTemplatePicker = true; break;
        case 'save': self.saveData(); self.$store.commit('toast/SHOW_TOAST', { message: '已保存', type: 'success' }); break;
        case 'bold': self.insertMarkdown('bold'); break;
        case 'italic': self.insertMarkdown('italic'); break;
        case 'codeblock': self.insertMarkdown('codeblock'); break;
        case 'table': self.insertMarkdown('table'); break;
        case 'fontSizeUp': self.adjustFontSize(1); break;
        case 'fontSizeDown': self.adjustFontSize(-1); break;
        case 'canvas': self.createDrawFile(); break;
        case 'tags': self.showTagModal = true; break;
        case 'versions': self.showVersionHistory = true; break;
        case 'focusMode': self.toggleFocusMode(); break;
        default:
          if (cmd.action.indexOf('mermaid-') === 0) {
            self.insertMarkdown(cmd.action);
          }
          break;
      }
    },
    executeCommandPalette: function() {
      var self = this;
      if (self.filteredCommandItems.length > 0) {
        self.executeCommand(self.filteredCommandItems[0]);
      }
    },
    toggleFocusMode: function() {
      var self = this;
      self.showSidebar = false;
      self.viewMode = 'edit';
      self.$store.commit('toast/SHOW_TOAST', { message: '焦点模式 - 按 Esc 退出', type: 'info' });
    },
    addFolder: function() {
      var self = this;
      self.$modal.prompt({
        title: '新建文件夹',
        message: '请输入文件夹名称:',
        placeholder: '文件夹名称',
        confirmText: '创建',
        cancelText: '取消'
      }).then(function(name) {
        if (!name || !name.trim()) return;
        name = name.trim();
        if (self.folders.indexOf(name) > -1) {
          self.$store.commit('toast/SHOW_TOAST', { message: '文件夹已存在', type: 'warning' });
          return;
        }
        self.folders.push(name);
        self.saveData();
      }).catch(function() {});
    },
    togglePinFile: function() {
      var self = this;
      var file = self.fileMenuTarget;
      if (!file) return;
      file.pinned = !file.pinned;
      self.showFileMenuModal = false;
      self.saveData();
    },
    toggleStarFile: function() {
      var self = this;
      var file = self.fileMenuTarget;
      if (!file) return;
      file.starred = !file.starred;
      self.showFileMenuModal = false;
      self.saveData();
    },
    uploadToCloud: function() {
      var self = this;
      if (!self.activeFile || self.activeFile.isPrivate) return;
      self.cloudSyncing = true;
      var data = {
        id: self.activeFile.id,
        title: self.activeFile.title || '',
        content: self.activeFile.content || '',
        tags: self.activeFile.tags || [],
        folder: self.activeFile.folder || '默认',
        visibility: self.activeFile.cloudVisibility || 'private',
        is_pinned: self.activeFile.pinned ? 1 : 0
      };
      api.post('/notes/notes', data).then(function(response) {
        if (response.data.code === 200) {
          self.$set(self.activeFile, 'cloudSynced', true);
          self.$set(self.activeFile, 'cloudVisibility', data.visibility);
          self.$store.commit('toast/SHOW_TOAST', { message: '已上传到云端', type: 'success' });
          self.loadCloudNotes();
          // 同步保存到云盘 note 目录（静默执行，不影响主流程）
          api.post('/cloud/note/' + data.id, {
            content: data.content,
            title: data.title,
            tags: data.tags,
            folder: data.folder
          }).catch(function() {});
        }
      }).catch(function(err) {
        var msg = '上传失败';
        if (err.response && err.response.data && err.response.data.message) msg = err.response.data.message;
        self.$store.commit('toast/SHOW_TOAST', { message: msg, type: 'error' });
      }).finally(function() {
        self.cloudSyncing = false;
      });
    },
    loadCloudNotes: function() {
      var self = this;
      api.get('/notes/notes').then(function(response) {
        if (response.data.code === 200) {
          self.cloudNotes = response.data.data || [];
          for (var i = 0; i < self.files.length; i++) {
            var synced = self.cloudNotes.some(function(cn) { return cn.id === self.files[i].id; });
            self.$set(self.files[i], 'cloudSynced', synced);
            if (synced) {
              var cloudNote = self.cloudNotes.find(function(cn) { return cn.id === self.files[i].id; });
              self.$set(self.files[i], 'cloudVisibility', cloudNote ? cloudNote.visibility : 'private');
            }
          }
        }
      }).catch(function() {});
    },
    toggleCloudVisibility: function(file) {
      var self = this;
      var newVisibility = file.cloudVisibility === 'public' ? 'private' : 'public';
      api.patch('/notes/notes/' + file.id + '/visibility', { visibility: newVisibility }).then(function(response) {
        if (response.data.code === 200) {
          self.$set(file, 'cloudVisibility', newVisibility);
          self.$store.commit('toast/SHOW_TOAST', { message: newVisibility === 'public' ? '已设为公开' : '已设为私密', type: 'success' });
        }
      }).catch(function(err) {
        var msg = '操作失败';
        if (err.response && err.response.data && err.response.data.message) msg = err.response.data.message;
        self.$store.commit('toast/SHOW_TOAST', { message: msg, type: 'error' });
      });
    },
    loadCloudFolders: function() {
      var self = this;
      api.get('/notes/folders').then(function(response) {
        if (response.data.code === 200) {
          self.cloudFolders = response.data.data || [];
        }
      }).catch(function() {});
    },
    createCloudFolder: function() {
      var self = this;
      var name = self.newCloudFolderName.trim();
      if (!name) return;
      api.post('/notes/folders', { name: name }).then(function(response) {
        if (response.data.code === 200) {
          self.loadCloudFolders();
          self.newCloudFolderName = '';
          self.showCloudFolderModal = false;
          self.$store.commit('toast/SHOW_TOAST', { message: '文件夹创建成功', type: 'success' });
        }
      }).catch(function(err) {
        var msg = '创建失败';
        if (err.response && err.response.data && err.response.data.message) msg = err.response.data.message;
        self.$store.commit('toast/SHOW_TOAST', { message: msg, type: 'error' });
      });
    },
    moveCloudNoteFolder: function(noteId, folder) {
      var self = this;
      api.patch('/notes/notes/' + noteId + '/folder', { folder: folder }).then(function(response) {
        if (response.data.code === 200) {
          self.loadCloudNotes();
          self.$store.commit('toast/SHOW_TOAST', { message: '已移动到 ' + folder, type: 'success' });
        }
      }).catch(function(err) {
        var msg = '移动失败';
        if (err.response && err.response.data && err.response.data.message) msg = err.response.data.message;
        self.$store.commit('toast/SHOW_TOAST', { message: msg, type: 'error' });
      });
    },
    deleteCloudNote: function(noteId) {
      var self = this;
      self.$modal.confirm({ message: '确定要从云端删除此笔记吗？' }).then(function(result) {
        if (!result) return;
        api.delete('/notes/notes/' + noteId).then(function(response) {
          if (response.data.code === 200) {
            self.loadCloudNotes();
            self.$store.commit('toast/SHOW_TOAST', { message: '已从云端删除', type: 'success' });
          }
        }).catch(function(err) {
          var msg = '删除失败';
          if (err.response && err.response.data && err.response.data.message) msg = err.response.data.message;
          self.$store.commit('toast/SHOW_TOAST', { message: msg, type: 'error' });
        });
      });
    },
    loadPublicNotes: function() {
      var self = this;
      self.publicNotesLoading = true;
      api.get('/notes/notes/public').then(function(response) {
        if (response.data.code === 200) {
          self.publicNotes = response.data.data || [];
        }
      }).catch(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '获取公开笔记失败', type: 'error' });
      }).finally(function() {
        self.publicNotesLoading = false;
      });
    },
    viewCloudNoteDetail: function(note) {
      var self = this;
      api.get('/notes/notes/' + note.id).then(function(response) {
        if (response.data.code === 200) {
          self.viewingCloudNote = response.data.data;
        }
      }).catch(function(err) {
        var msg = '获取笔记详情失败';
        if (err.response && err.response.data && err.response.data.message) msg = err.response.data.message;
        self.$store.commit('toast/SHOW_TOAST', { message: msg, type: 'error' });
      });
    },
    importCloudNote: function(note) {
      var self = this;
      var newFile = {
        id: 'note_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        title: note.title || '未命名笔记',
        content: note.content || '',
        type: 'note',
        tags: note.tags || [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isPrivate: false,
        canvasData: null,
        annotations: [],
        templateId: null,
        versions: [],
        folder: '默认',
        pinned: false
      };
      self.files.push(newFile);
      self.activeFileId = newFile.id;
      self.saveData();
      self.viewingCloudNote = null;
      self.showCloudPanel = false;
      self.$store.commit('toast/SHOW_TOAST', { message: '已转载到本地笔记', type: 'success' });
    },
    // ============ 批注系统 ============
    startAnnotation: function() {
      var self = this;
      if (self.viewMode === 'edit') {
        self.viewMode = 'split';
        // 等分屏渲染后再打开批注层
        self.$nextTick(function() {
          self.showAnnotationLayer = true;
        });
      } else {
        self.showAnnotationLayer = true;
      }
    },

    toggleAnnotationLayer: function() {
      var self = this;
      self.showAnnotationLayer = !self.showAnnotationLayer;
      if (!self.showAnnotationLayer) {
        // 退出批注时保存
        self.saveData();
      }
    },

    onAnnotationSave: function(canvasData) {
      var self = this;
      if (!self.activeFile) return;
      self.activeFile.canvasData = canvasData;
      self.activeFile.updatedAt = new Date().toISOString();
      self.saveData();
    },

    commitAnnotationCard: function() {
      var self = this;
      var text = self.annotationInput.trim();
      if (!text) { self.showAnnotationInput = false; return; }
      if (!self.activeFile || self.activeFile.type === 'draw') return;
      if (!self.activeFile.annotations) {
        self.$set(self.activeFile, 'annotations', []);
      }
      self.activeFile.annotations.push({
        id: 'a_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        text: text,
        selectedText: self.annotationSelectedText || '',
        color: self.annotationColor,
        createdAt: new Date().toISOString()
      });
      self.activeFile.updatedAt = new Date().toISOString();
      self.annotationInput = '';
      self.annotationSelectedText = '';
      self.showAnnotationInput = false;
      self.saveData();
      self.$store.commit('toast/SHOW_TOAST', { message: '批注已添加', type: 'success' });
    },

    addAnnotationCard: function(selectedText) {
      var self = this;
      if (!self.activeFile || self.activeFile.type === 'draw') return;
      if (!self.activeFile.annotations) {
        self.$set(self.activeFile, 'annotations', []);
      }
      self.annotationInput = '';
      self.annotationSelectedText = selectedText || '';
      self.annotationColor = '#ffc107';
      self.showAnnotationInput = true;
      // 不弹出原生 prompt，显示内置输入框
      self.$nextTick(function() {
        var el = document.getElementById('annotation-inline-input');
        if (el) el.focus();
      });
    },

    deleteAnnotation: function(annoId) {
      var self = this;
      if (!self.activeFile || !self.activeFile.annotations) return;
      var idx = self.activeFile.annotations.findIndex(function(a) { return a.id === annoId; });
      if (idx > -1) {
        self.activeFile.annotations.splice(idx, 1);
        self.activeFile.updatedAt = new Date().toISOString();
        self.saveData();
      }
    },

    onPreviewTextSelect: function() {
      var self = this;
      if (self.showAnnotationLayer) return; // 批注涂鸦模式下不触发
      setTimeout(function() {
        var selection = window.getSelection();
        if (!selection || selection.isCollapsed || !selection.toString().trim()) return;
        var selectedText = selection.toString().trim();
        if (selectedText.length < 1) return;
        // 在预览区选中文字时自动弹出批注提示
        // 使用轻量提示：在选中的文本下方显示一个小按钮
        // 为了避免过于复杂，这里直接用简单的确认
        if (selectedText.length > 0 && selectedText.length < 500) {
          // 不自动弹出，让用户通过编辑器批注按钮来添加
          // 但保留这个钩子供未来扩展
        }
      }, 300);
    },

    renderAnnotationText: function(text) {
      if (!text) return '';
      // 简单的 markdown 处理
      var html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br>');
      return html;
    },

    // ============ 画板模式 ============
    createNoteFile: function() {
      this.showTemplatePicker = true;
    },

    exitDrawFile: function() {
      var self = this;
      // 切到最近的非画板文件
      var noteFile = self.allFiles.find(function(f) { return f.type !== 'draw'; });
      if (noteFile) {
        self.activeFileId = noteFile.id;
      }
    },

    onDrawSave: function(canvasData) {
      var self = this;
      if (!self.activeFile) return;
      self.activeFile.canvasData = canvasData;
      self.activeFile.updatedAt = new Date().toISOString();
      self.saveData();
    },

    createDrawFile: function() {
      var self = this;
      var id = generateId();
      var now = new Date().toISOString();
      var file = {
        id: id,
        title: '未命名画板 ' + new Date().toLocaleDateString('zh-CN'),
        content: '',
        type: 'draw',
        tags: [],
        folder: self.activeFolder !== '全部' ? self.activeFolder : null,
        canvasData: [],
        annotations: null,
        createdAt: now,
        updatedAt: now,
        pinned: false,
        privacyId: null
      };
      self.files.unshift(file);
      self.activeFileId = id;
      self.showSidebar = true;
      self.saveData();
    }
  }
};
</script>

<style scoped>
.notes-page {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-color);
}

.notes-body {
  flex: 1;
  display: flex;
  min-height: 0;
  position: relative;
}

.nav-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  color: var(--primary-color);
  transition: background 0.15s;
  background: none;
  border: none;
  cursor: pointer;
}

.nav-action-btn:hover {
  background: var(--primary-light);
}

.nav-btn-primary {
  color: #FFFFFF;
  background: var(--primary-color);
}
.nav-btn-primary:hover {
  opacity: .9;
  background: var(--primary-color);
}

/* 新建下拉菜单 */
.nav-create-dropdown {
  position: relative;
}

.create-menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 6px;
  background: var(--card-bg);
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
  border: 0.5px solid var(--separator-color);
  padding: 6px;
  z-index: 3000;
  min-width: 160px;
}

.create-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 14px;
  border: none;
  background: none;
  color: var(--text-primary);
  font-size: 14px;
  cursor: pointer;
  border-radius: 8px;
  transition: background 0.15s;
  touch-action: manipulation;
  min-height: 44px;
}

.create-menu-item:hover {
  background: var(--bg-color);
}

.create-menu-item:active {
  background: var(--primary-light);
  transform: scale(0.97);
}

.create-menu-item i {
  font-size: 18px;
  width: 24px;
  text-align: center;
}

.dropdown-fade-enter-active,
.dropdown-fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.dropdown-fade-enter,
.dropdown-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.nav-mode-switch {
  display: flex;
  align-items: center;
  background: var(--bg-color);
  border-radius: var(--radius-sm);
  padding: 2px;
  margin-left: 4px;
  border: 1px solid var(--border-color);
}

.mode-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
  cursor: pointer;
  border: none;
  background: none;
  transition: all 0.2s var(--ease-standard);
}

.mode-btn:hover {
  color: var(--primary-color);
  background: var(--primary-light);
}

.mode-btn:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.mode-btn.active {
  color: #FFFFFF;
  background: var(--primary-color);
}

.notes-sidebar {
  width: 280px;
  background: var(--sidebar-bg);
  border-right: 0.5px solid var(--separator-color);
  backdrop-filter: var(--glass-blur-container);
  -webkit-backdrop-filter: var(--glass-blur-container);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  box-shadow: var(--shadow-sm);
  z-index: 20;
}

.sidebar-top {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 12px 8px;
  flex-shrink: 0;
}

.sidebar-search {
  flex: 1;
  display: flex;
  align-items: center;
  background: var(--bg-color);
  border-radius: var(--radius-md);
  padding: 0 10px;
  height: 44px;
  border: 1px solid var(--border-color);
  transition: border-color 0.15s, box-shadow 0.15s;
}

.sidebar-search:focus-within {
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px var(--primary-light);
}

.sidebar-search-icon {
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
  margin-right: 6px;
  flex-shrink: 0;
}

.sidebar-search-input {
  flex: 1;
  border: none;
  background: none;
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  height: 100%;
  outline: none;
}

.sidebar-search-input::placeholder {
  color: var(--text-tertiary);
}

.sidebar-new-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  background: var(--primary-color);
  color: #FFFFFF;
  font-size: var(--font-size-sm);
  cursor: pointer;
  border: none;
  flex-shrink: 0;
  transition: background 0.15s;
}

.sidebar-new-btn:hover {
  opacity: 0.9;
}

.sidebar-import-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  background: var(--bg-color);
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  cursor: pointer;
  border: 1px solid var(--border-color);
  flex-shrink: 0;
  transition: all 0.15s;
}

.sidebar-import-btn:hover {
  color: var(--primary-color);
  border-color: var(--primary-color);
  background: var(--primary-light);
}

.tag-filter-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 12px 8px;
  flex-shrink: 0;
}

.tag-filter-label {
  font-size: var(--font-size-sm);
  color: var(--primary-color);
  font-weight: var(--font-weight-semibold);
}

.tag-filter-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  color: var(--text-tertiary);
  font-size: var(--font-size-caption2);
  cursor: pointer;
  border: none;
  background: none;
}

.tag-filter-clear:hover {
  color: var(--danger-color);
  background: rgba(var(--danger-rgb), 0.08);
}

.tag-filter-clear:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.sidebar-file-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px;
}

.file-item {
  padding: 12px 14px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background 0.15s;
  margin-bottom: 2px;
}

.file-item:hover {
  background: var(--primary-light);
}

.file-item:active {
  background: var(--border-color);
}

.file-item.active {
  background: var(--primary-light);
  border-left: 3px solid var(--primary-color);
}

.file-item-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.file-item-title {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 6px;
}

.file-type-icon {
  flex-shrink: 0;
  font-size: 14px;
}

.file-type-icon.note-type {
  color: var(--text-tertiary);
}

.file-type-icon.draw-type {
  color: #ff6b6b;
}

.file-item-date {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
}

.file-item-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}

.file-tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: var(--radius-xs);
  font-size: var(--font-size-caption2);
  background: var(--primary-light);
  color: var(--primary-color);
  cursor: pointer;
  transition: background 0.15s;
}

.file-tag:hover {
  background: rgba(var(--primary-rgb), 0.15);
}

.sidebar-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  color: var(--text-tertiary);
  gap: 8px;
  font-size: var(--font-size-sm);
}

.sidebar-empty i {
  font-size: var(--font-size-title1);
  opacity: 0.4;
}

.sidebar-bottom {
  padding: 8px 12px;
  border-top: 0.5px solid var(--separator-color);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sidebar-paste-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  cursor: pointer;
  border: none;
  background: none;
  transition: background 0.15s, color 0.15s;
}

.sidebar-paste-btn:hover {
  background: var(--primary-light);
  color: var(--primary-color);
}

.privacy-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  cursor: pointer;
  border: none;
  background: none;
  transition: background 0.15s, color 0.15s;
}

.privacy-entry:hover {
  background: var(--primary-light);
  color: var(--primary-color);
}

.sidebar-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 15;
}

.notes-main {
  flex: 1;
  display: flex;
  min-height: 0;
  background: var(--card-bg);
  overflow: hidden;
}

.notes-main.sidebar-collapsed {
  border-left: none;
}

.editor-area {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  transition: width 0.3s var(--ease-standard);
}

.editor-area.resizing {
  transition: none;
}

.editor-header {
  padding: 8px 12px 6px;
  flex-shrink: 0;
  border-bottom: 0.5px solid var(--separator-color);
}

.editor-title-input {
  width: 100%;
  border: none;
  background: none;
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  padding: 0;
  outline: none;
}

.editor-title-input::placeholder {
  color: var(--text-tertiary);
}

.editor-title-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
}

.editor-date {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
}

.editor-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.editor-tag-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
  cursor: pointer;
  border: none;
  background: none;
  transition: color 0.15s, background 0.15s;
}

.editor-tag-btn:hover {
  color: var(--primary-color);
  background: var(--primary-light);
}

.editor-tag-btn:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.editor-toolbar {
  display: flex;
  align-items: center;
  gap: 1px;
  padding: 4px 8px;
  border-bottom: 0.5px solid var(--separator-color);
  flex-shrink: 0;
  flex-wrap: nowrap;
  overflow-x: auto;
  overflow-y: hidden;
  background: var(--bg-color);
  scrollbar-width: none;
}

.editor-toolbar::-webkit-scrollbar {
  display: none;
}

.toolbar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  cursor: pointer;
  border: none;
  background: none;
  transition: background 0.15s, color 0.15s;
  position: relative;
  flex-shrink: 0;
}

.toolbar-btn:hover {
  background: var(--primary-light);
  color: var(--primary-color);
}

.toolbar-btn:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.toolbar-sub {
  font-size: var(--font-size-caption2);
  font-weight: 700;
  position: absolute;
  bottom: 4px;
  right: 4px;
}

.toolbar-sep {
  width: 1px;
  height: 24px;
  background: var(--border-color);
  margin: 0 4px;
}

.toolbar-latex {
  font-family: 'Times New Roman', serif;
  font-style: italic;
  font-size: var(--font-size-body);
}

.editor-content {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
}

.editor-textarea {
  width: 100%;
  height: 100%;
  border: none;
  background: var(--card-bg);
  color: var(--text-primary);
  padding: 12px 16px;
  line-height: 1.8;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', 'Menlo', monospace;
  resize: none;
  outline: none;
  tab-size: 2;
  box-sizing: border-box;
}

.editor-textarea::placeholder {
  color: var(--text-tertiary);
}

.editor-footer {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 4px 12px;
  border-top: 0.5px solid var(--separator-color);
  flex-shrink: 0;
  background: var(--bg-color);
}

.footer-stat {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
}

.save-indicator {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
  transition: color 0.3s;
}

.save-indicator i {
  font-size: var(--font-size-caption2);
}

.save-indicator.saved {
  color: var(--success-color);
}

.editor-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: var(--text-tertiary);
}

.empty-icon {
  font-size: 56px;
  opacity: 0.3;
}

.empty-text {
  font-size: var(--font-size-base);
}

.preview-area {
  border-left: 0.5px solid var(--separator-color);
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: var(--card-bg);
  min-width: 0;
  transition: width 0.3s var(--ease-standard);
}

.preview-area.resizing {
  transition: none;
}

.editor-resizer {
  width: 12px;
  cursor: col-resize;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  z-index: 10;
  transition: background 0.15s;
}

.editor-resizer:hover {
  background: var(--primary-lighter);
}

.editor-resizer:hover .resizer-line {
  background: var(--primary-color);
}

.resizer-line {
  width: 2px;
  height: 32px;
  border-radius: 1px;
  background: var(--border-color);
  transition: background 0.15s, height 0.15s;
}

.editor-resizer:hover .resizer-line {
  height: 48px;
}

.preview-header {
  padding: 6px 12px;
  border-bottom: 0.5px solid var(--separator-color);
  flex-shrink: 0;
  background: var(--bg-color);
}

.preview-label {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--text-secondary);
}

.preview-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  line-height: 1.8;
  font-size: var(--font-size-base);
  color: var(--text-primary);
  min-height: 0;
  word-break: break-word;
  overflow-wrap: break-word;
  /* 让 .annotation-overlay 的 absolute 定位以本元素为参照 */
  position: relative;
}

/* 内容内部容器：包裹渲染HTML和批注涂鸦层，作为滚动内容的一部分 */
.preview-content-inner {
  position: relative;
}

/* 承载 v-html 的容器 */
.preview-content-html {
  position: relative;
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: var(--glass-blur-thin);
  -webkit-backdrop-filter: var(--glass-blur-thin);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3000;
}

.modal-panel {
  width: 440px;
  max-width: 90vw;
  background: var(--card-bg);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 0.5px solid var(--separator-color);
}

.modal-title {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 8px;
}

.modal-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  color: var(--text-tertiary);
  font-size: var(--font-size-callout);
  cursor: pointer;
  border: none;
  background: none;
  transition: background 0.15s, color 0.15s;
}

.modal-close:hover {
  background: var(--primary-light);
  color: var(--text-primary);
}

.modal-close:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.modal-body {
  padding: 20px;
}

.modal-input {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  font-size: var(--font-size-base);
  background: var(--bg-color);
  color: var(--text-primary);
  margin-bottom: 12px;
  box-sizing: border-box;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.modal-btn {
  width: 100%;
  margin-top: 4px;
}

.privacy-hint {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  margin-bottom: 12px;
}

.privacy-setup {
  margin-top: 4px;
}

.privacy-toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.privacy-toolbar .btn-secondary {
  font-size: var(--font-size-sm);
  padding: 8px 14px;
}

.privacy-file-list {
  max-height: 300px;
  overflow-y: auto;
  margin-bottom: 16px;
}

.tag-modal .tag-input-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.tag-modal .tag-input-row .modal-input {
  flex: 1;
  margin-bottom: 0;
}

.tag-modal .tag-input-row .btn-primary {
  flex-shrink: 0;
  padding: 10px 16px;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 16px;
  margin-bottom: 16px;
}

.tag-item {
  display: inline-block;
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  background: var(--bg-color);
  color: var(--text-secondary);
  cursor: pointer;
  border: 1px solid var(--border-color);
  transition: all 0.15s;
}

.tag-item:hover {
  border-color: var(--primary-color);
  color: var(--primary-color);
}

.tag-item.active {
  background: var(--primary-light);
  color: var(--primary-color);
  border-color: var(--primary-color);
}

.current-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  padding-top: 12px;
  border-top: 0.5px solid var(--separator-color);
}

.current-tags-label {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  margin-right: 4px;
}

.current-tags .tag-item.active i {
  margin-left: 4px;
  font-size: var(--font-size-caption2);
}

.no-tags {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
}

.context-menu {
  position: fixed;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  padding: 4px;
  z-index: 2000;
  min-width: 180px;
}

.context-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 14px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  cursor: pointer;
  border: none;
  background: none;
  text-align: left;
  transition: background 0.15s;
}

.context-menu-item:hover {
  background: var(--primary-light);
}

.context-menu-item.danger {
  color: var(--danger-color);
}

.context-menu-item.danger:hover {
  background: rgba(var(--danger-rgb), 0.08);
}

.template-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.template-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px 12px;
  border-radius: var(--radius-md);
  border: 2px solid var(--border-color);
  cursor: pointer;
  transition: all 0.2s ease;
  background: var(--bg-color);
}

.template-card:hover {
  border-color: var(--primary-color);
  background: var(--primary-light);
}

.template-icon {
  font-size: var(--font-size-title1);
  color: var(--primary-color);
  margin-bottom: 8px;
}

.template-name {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
}

.version-modal .modal-panel {
  width: 520px;
}

.version-list {
  max-height: 400px;
  overflow-y: auto;
}

.version-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
  margin-bottom: 8px;
  transition: background 0.15s;
}

.version-item:hover {
  background: var(--primary-light);
}

.version-info {
  flex: 1;
  min-width: 0;
}

.version-time {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  margin-bottom: 2px;
}

.version-summary {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.version-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
  margin-left: 12px;
}

.btn-sm {
  padding: 4px 10px;
  font-size: var(--font-size-sm);
}

.version-preview-modal {
  width: 600px;
  max-width: 90vw;
}

.version-preview-content {
  max-height: 400px;
  overflow-y: auto;
  padding: 16px;
  background: var(--bg-color);
  border-radius: var(--radius-md);
  line-height: 1.7;
  color: var(--text-primary);
}

/* ========== 批注系统 ========== */
.preview-anno-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--card-bg);
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  margin-left: auto;
  transition: all 0.15s;
  touch-action: manipulation;
  min-height: 36px;
}

.preview-anno-toggle:active {
  transform: scale(0.95);
  opacity: 0.7;
}

.preview-anno-toggle.active {
  background: var(--primary-color);
  color: #FFFFFF;
  border-color: var(--primary-color);
}

.preview-content-wrap {
  position: relative;
  /* 在 .preview-area 的 flex 列布局中占满剩余空间并允许收缩 */
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.annotation-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 10;
  overflow: hidden;
  pointer-events: none;
  background: transparent;
}

.annotation-overlay.annotation-active {
  pointer-events: auto;
}

.anno-input-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 24px;
  background: var(--card-bg);
  border-bottom: 0.5px solid var(--separator-color);
}

.anno-input-field {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  font-size: 14px;
  outline: none;
  background: var(--bg-color);
  color: var(--text-primary);
  min-height: 36px;
}

.anno-input-field:focus {
  border-color: var(--primary-color);
}

.annotation-cards-section {
  padding: 12px 24px 16px;
  border-top: 0.5px solid var(--separator-color);
}

.annotation-cards-label {
  font-size: 13px;
  font-weight: var(--font-weight-semibold);
  color: var(--text-secondary);
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.annotation-card {
  border-left: 4px solid #ffc107;
  background: var(--card-bg);
  padding: 10px 14px;
  margin-bottom: 10px;
  border-radius: 0 10px 10px 0;
  box-shadow: var(--shadow-sm);
}

.annotation-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.annotation-card-time {
  font-size: 11px;
  color: var(--text-tertiary);
}

.annotation-card-del {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  height: 32px;
  border: none;
  background: none;
  color: var(--text-tertiary);
  cursor: pointer;
  border-radius: 6px;
  font-size: 13px;
  touch-action: manipulation;
}

.annotation-card-del:active {
  color: var(--danger-color);
  transform: scale(0.9);
}

.annotation-card-quote {
  font-style: italic;
  color: var(--text-secondary);
  border-left: 2px solid var(--border-color);
  padding-left: 10px;
  margin-bottom: 8px;
  font-size: 13px;
}

.annotation-card-text {
  font-size: 14px;
  color: var(--text-primary);
  line-height: 1.6;
}

/* ========== 画板模式 ========== */
.draw-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.draw-body--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-color);
}

.draw-empty-state {
  text-align: center;
  padding: 40px;
}

.draw-empty-icon {
  font-size: 64px;
  color: var(--text-tertiary);
  margin-bottom: 16px;
  display: block;
}

.draw-empty-state h3 {
  font-size: 18px;
  font-weight: var(--font-weight-semibold);
  margin-bottom: 8px;
  color: var(--text-primary);
}

.draw-empty-state p {
  font-size: 14px;
  color: var(--text-secondary);
  margin-bottom: 20px;
}

.resource-picker-item {
  display: flex;
  align-items: center;
  padding: 10px 16px;
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: background 0.15s;
}

.resource-picker-item:hover {
  background: var(--bg-color);
}

.resource-picker-item.is-dir {
  color: var(--primary-color);
  font-weight: var(--font-weight-semibold);
}

.resource-picker-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.resource-picker-size {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
  margin-left: 12px;
  flex-shrink: 0;
}

.mermaid-chart-wrapper {
  position: relative;
  margin: 12px 0;
  text-align: center;
  background: var(--card-bg);
  border-radius: var(--radius-md);
  padding: 16px;
  border: 1px solid var(--border-color);
  overflow: hidden;
}

.mermaid-chart {
  display: flex;
  justify-content: center;
  overflow-x: auto;
}

.mermaid-chart svg {
  max-width: 100%;
  height: auto;
}

.mermaid-chart-actions {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s;
}

.mermaid-chart-wrapper:hover .mermaid-chart-actions {
  opacity: 1;
}

.mermaid-edit-btn,
.mermaid-zoom-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: var(--font-size-caption);
  transition: all 0.15s;
}

.mermaid-edit-btn:hover,
.mermaid-zoom-btn:hover {
  color: var(--primary-color);
  border-color: var(--primary-color);
}

.mermaid-edit-btn:active,
.mermaid-zoom-btn:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.mermaid-error {
  color: var(--danger-color);
  background: rgba(var(--danger-rgb), 0.08);
  padding: 12px 16px;
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
}

.mermaid-error-code {
  margin-top: 8px;
  background: var(--bg-color);
  padding: 8px 12px;
  border-radius: var(--radius-xs);
  font-family: monospace;
  font-size: var(--font-size-caption);
  white-space: pre-wrap;
}

.mermaid-zoom-panel {
  width: 95vw;
  max-width: 100vw;
  height: 92vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.zoom-overlay {
  z-index: 1000;
}

.zoom-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  border-bottom: 0.5px solid var(--separator-color);
}

.zoom-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  margin-right: 8px;
}

.zoom-ctrl-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  cursor: pointer;
  font-size: var(--font-size-sm);
  transition: all 0.15s;
}

.zoom-ctrl-btn:hover {
  background: var(--primary-color);
  color: #FFFFFF;
  border-color: var(--primary-color);
}

.zoom-ctrl-btn:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.zoom-level {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-secondary);
  min-width: 48px;
  text-align: center;
  -webkit-user-select: none;
  user-select: none;
}

.zoom-viewport {
  flex: 1;
  overflow: hidden;
  position: relative;
  cursor: grab;
  background:
    repeating-linear-gradient(0deg, transparent, transparent 19px, var(--border-color) 19px, var(--border-color) 20px),
    repeating-linear-gradient(90deg, transparent, transparent 19px, var(--border-color) 19px, var(--border-color) 20px);
}

.zoom-viewport:active {
  cursor: grabbing;
}

.zoom-stage {
  position: absolute;
  top: 50%;
  left: 50%;
  transform-origin: 0 0;
  -webkit-user-select: none;
  user-select: none;
}

.zoom-stage .mermaid-zoom-content {
  display: inline-block;
}

.zoom-stage .mermaid-zoom-content svg {
  display: block;
  max-width: none;
  height: auto;
}

.zoom-hint {
  flex-shrink: 0;
  text-align: center;
  padding: 6px 16px;
  font-size: var(--font-size-caption2);
  color: var(--text-secondary);
  border-top: 0.5px solid var(--separator-color);
  -webkit-user-select: none;
  user-select: none;
}

/* Inline chart improvements for small screens */
.mermaid-chart-wrapper {
  position: relative;
  margin: 12px 0;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--card-bg);
  overflow: hidden;
}

.mermaid-chart {
  padding: 12px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.mermaid-chart svg {
  display: block;
  max-width: none;
  min-width: 280px;
  height: auto;
}

.chart-editor-panel {
  width: 95vw;
  max-width: 1200px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}

.chart-editor-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  border-bottom: 0.5px solid var(--separator-color);
  background: var(--bg-color);
  flex-shrink: 0;
  overflow-x: auto;
}

.chart-toolbar-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.chart-toolbar-sep {
  width: 1px;
  height: 24px;
  background: var(--border-color);
  margin: 0 6px;
  flex-shrink: 0;
}

.chart-tool-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 40px;
  height: 40px;
  padding: 0 10px;
  border-radius: var(--radius-md);
  background: none;
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: var(--font-size-sm);
  transition: all 0.15s;
  gap: 6px;
  white-space: nowrap;
}

.chart-tool-btn:hover,
.chart-tool-btn:active {
  color: var(--primary-color);
  border-color: var(--primary-color);
  background: var(--primary-light);
}

.chart-preview-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-tertiary);
  padding: 40px;
}

.chart-preview-empty i {
  font-size: 48px;
  opacity: 0.3;
}

.chart-editor-body {
  display: flex;
  flex: 1;
  min-height: 0;
  max-height: calc(90vh - 140px);
}

.chart-editor-visual {
  flex: 1;
  display: flex;
  flex-direction: column;
  border-right: 0.5px solid var(--separator-color);
  min-width: 0;
}

.chart-preview-area {
  flex: 1;
  overflow: auto;
  padding: 16px;
  background: var(--card-bg);
  display: flex;
  justify-content: center;
  align-items: flex-start;
}

.chart-preview-svg {
  display: flex;
  justify-content: center;
}

.chart-preview-svg svg {
  max-width: 100%;
  height: auto;
}

.chart-editor-code {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.chart-code-textarea {
  flex: 1;
  width: 100%;
  border: none;
  background: var(--bg-color);
  color: var(--text-primary);
  padding: 16px;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: var(--font-size-sm);
  line-height: 1.6;
  resize: none;
  outline: none;
  tab-size: 2;
}

.command-palette-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.3);
  z-index: 3000;
  display: flex;
  justify-content: center;
  padding-top: 15vh;
}

.command-palette {
  width: 520px;
  max-width: 90vw;
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  max-height: 400px;
  display: flex;
  flex-direction: column;
}

.command-palette-input-wrap {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 0.5px solid var(--separator-color);
}

.command-palette-icon {
  color: var(--text-tertiary);
  margin-right: 10px;
}

.command-palette-input {
  flex: 1;
  border: none;
  background: none;
  font-size: var(--font-size-md);
  color: var(--text-primary);
  outline: none;
}

.command-palette-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}

.command-palette-item {
  display: flex;
  align-items: center;
  padding: 10px 14px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.1s;
  color: var(--text-primary);
  font-size: var(--font-size-sm);
}

.command-palette-item:hover {
  background: var(--primary-light);
}

.command-palette-label {
  flex: 1;
}

.command-palette-shortcut {
  font-size: var(--font-size-caption2);
  color: var(--text-tertiary);
  background: var(--bg-color);
  padding: 2px 8px;
  border-radius: var(--radius-xs);
  border: 1px solid var(--border-color);
}

.folder-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px 8px;
  flex-shrink: 0;
}

.folder-select,
.sort-select {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-color);
  color: var(--text-primary);
  font-size: var(--font-size-sm);
  outline: none;
  cursor: pointer;
}

.folder-select:focus,
.sort-select:focus {
  border-color: var(--primary-color);
}

.folder-add-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  background: none;
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s;
}

.folder-add-btn:hover {
  color: var(--primary-color);
  border-color: var(--primary-color);
}

.folder-add-btn:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.file-item-meta {
  display: flex;
  align-items: center;
  gap: 4px;
}

.file-badge-icon {
  font-size: var(--font-size-caption2);
  color: var(--text-tertiary);
}

.file-badge-icon.starred {
  color: var(--warning-color);
}

.search-highlight {
  background: rgba(var(--warning-rgb), 0.3);
  color: inherit;
  padding: 0 2px;
  border-radius: 2px;
}

.sidebar-slide-enter-active,
.sidebar-slide-leave-active {
  transition: transform 0.25s var(--ease-standard), opacity 0.25s var(--ease-standard);
}

.sidebar-slide-enter,
.sidebar-slide-leave-to {
  transform: translateX(-100%);
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

.markdown-body >>> h1 {
  font-size: 1.8em;
  font-weight: 700;
  margin: 16px 0 8px;
  padding-bottom: 6px;
  border-bottom: 0.5px solid var(--separator-color);
}

.markdown-body >>> h2 {
  font-size: 1.5em;
  font-weight: 600;
  margin: 14px 0 6px;
  padding-bottom: 4px;
  border-bottom: 0.5px solid var(--separator-color);
}

.markdown-body >>> h3 {
  font-size: 1.25em;
  font-weight: 600;
  margin: 12px 0 4px;
}

.markdown-body >>> h4 {
  font-size: 1.1em;
  font-weight: 600;
  margin: 10px 0 4px;
}

.markdown-body >>> h5,
.markdown-body >>> h6 {
  font-size: 1em;
  font-weight: 600;
  margin: 8px 0 4px;
}

.markdown-body >>> p {
  margin: 8px 0;
}

.markdown-body >>> ul,
.markdown-body >>> ol {
  padding-left: 20px;
  margin: 8px 0;
}

.markdown-body >>> li {
  margin: 4px 0;
}

.markdown-body >>> blockquote {
  border-left: 3px solid var(--primary-color);
  padding-left: 12px;
  margin: 8px 0;
  color: var(--text-secondary);
  background: var(--primary-lighter);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  padding: 8px 12px;
}

.markdown-body >>> code {
  background: var(--bg-color);
  padding: 2px 6px;
  border-radius: var(--radius-xs);
  font-size: 0.9em;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
}

.markdown-body >>> pre {
  background: var(--bg-color);
  padding: 16px;
  border-radius: var(--radius-sm);
  overflow-x: auto;
  margin: 8px 0;
  position: relative;
}

.markdown-body >>> pre code {
  background: none;
  padding: 0;
  display: block;
  white-space: pre;
  word-break: normal;
  word-wrap: normal;
  overflow-x: auto;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 0.9em;
  line-height: 1.5;
}

.markdown-body >>> .code-block-wrapper {
  position: relative;
  margin: 8px 0;
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: #1e1e2e;
}

.markdown-body >>> .code-block-inner {
  display: flex;
  overflow-x: auto;
  padding: 16px 0;
}

.markdown-body >>> .code-line-numbers {
  display: flex;
  flex-direction: column;
  padding: 0 12px;
  text-align: right;
  user-select: none;
  -webkit-user-select: none;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  min-width: 40px;
}

.markdown-body >>> .code-line-number {
  display: block;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 0.85em;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.25);
}

.markdown-body >>> .code-block-content {
  display: flex;
  flex-direction: column;
  padding: 0 16px;
  white-space: pre;
  word-break: normal;
  word-wrap: normal;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 0.9em;
  line-height: 1.5;
  background: none;
  flex: 1;
  min-width: 0;
}

.markdown-body >>> .code-line {
  display: block;
}

.markdown-body >>> .code-lang-label {
  position: absolute;
  top: 6px;
  right: 8px;
  font-size: var(--font-size-caption2);
  color: rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.08);
  padding: 1px 6px;
  border-radius: var(--radius-xs);
}

.markdown-body >>> .table-wrapper {
  overflow-x: auto;
  margin: 8px 0;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color);
}

.markdown-body >>> table.md-table {
  border-collapse: collapse;
  width: 100%;
  font-size: var(--font-size-sm);
}

.markdown-body >>> table.md-table th {
  background: var(--bg-color);
  font-weight: 600;
  color: var(--text-primary);
  padding: 10px 14px;
  text-align: left;
  border: 1px solid var(--border-color);
}

.markdown-body >>> table.md-table td {
  padding: 8px 14px;
  text-align: left;
  border: 1px solid var(--border-color);
  color: var(--text-primary);
}

.markdown-body >>> table.md-table tr:hover td {
  background: var(--primary-lighter);
}

.markdown-body >>> a {
  color: var(--primary-color);
  text-decoration: none;
}

.markdown-body >>> a:hover {
  text-decoration: underline;
}

.markdown-body >>> img {
  max-width: 100%;
  border-radius: var(--radius-sm);
}

.markdown-body >>> hr {
  border: none;
  border-top: 0.5px solid var(--separator-color);
  margin: 16px 0;
}

.markdown-body >>> .katex {
  font-size: 1.1em;
}

.markdown-body >>> .katex-display-wrapper {
  overflow-x: auto;
  overflow-y: hidden;
  padding: 8px 0;
  text-align: center;
}

.markdown-body >>> .katex-display {
  overflow-x: auto;
  overflow-y: hidden;
  padding: 8px 0;
  margin: 4px 0;
}

.markdown-body >>> .katex-html {
  max-width: 100%;
  overflow-x: auto;
}

/* LaTeX 文档样式 */
.markdown-body >>> .latex-document {
  line-height: 1.6;
  padding: 16px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color);
  margin: 8px 0;
}
.markdown-body >>> .latex-tt {
  font-family: 'Menlo', 'Consolas', 'Courier New', monospace;
  background: rgba(127, 127, 127, 0.1);
  padding: 1px 4px;
  border-radius: var(--radius-xs);
}
.markdown-body >>> .latex-pagebreak {
  border: none;
  border-top: 1px dashed var(--border-color);
  margin: 16px 0;
}
.markdown-body >>> .latex-block-wrapper {
  margin: 8px 0;
}
.markdown-body >>> .latex-colorbox {
  display: inline-block;
  padding: 2px 6px;
  border-radius: var(--radius-xs);
  line-height: 1.5;
}
.markdown-body >>> .latex-fbox {
  display: inline-block;
  border: 1px solid currentColor;
  padding: 4px 8px;
}
.markdown-body >>> .latex-parbox {
  display: block;
}
.markdown-body >>> .latex-list {
  padding-left: 2em;
  margin: 4px 0;
}
.markdown-body >>> .latex-list li {
  margin: 2px 0;
}
.markdown-body >>> .latex-quote {
  margin: 8px 0;
  padding: 8px 16px;
  border-left: 3px solid var(--border-color);
  font-style: italic;
  opacity: 0.9;
}
.markdown-body >>> .latex-verbatim {
  background: rgba(127, 127, 127, 0.08);
  padding: 8px 12px;
  border-radius: var(--radius-xs);
  font-family: 'Menlo', 'Consolas', monospace;
  font-size: var(--font-size-sm);
  white-space: pre-wrap;
}
.markdown-body >>> .latex-abstract {
  margin: 8px 0;
  padding: 8px 12px;
  font-size: 0.95em;
  opacity: 0.85;
}
.markdown-body >>> .latex-verse {
  margin: 8px 0;
  padding-left: 2em;
  white-space: pre-line;
}
/* LaTeX 字体大小 */
.markdown-body >>> .latex-tiny        { font-size: 0.5em; }
.markdown-body >>> .latex-footnotesize { font-size: 0.7em; }
.markdown-body >>> .latex-small       { font-size: 0.85em; }
.markdown-body >>> .latex-normalsize  { font-size: 1em; }
.markdown-body >>> .latex-large       { font-size: 1.2em; }
.markdown-body >>> .latex-Large       { font-size: 1.44em; }
.markdown-body >>> .latex-LARGE       { font-size: 1.73em; }
.markdown-body >>> .latex-huge        { font-size: 2.07em; }
.markdown-body >>> .latex-Huge        { font-size: 2.5em; }

.markdown-body >>> .latex-error {
  color: var(--danger-color);
  background: rgba(var(--danger-rgb), 0.1);
  padding: 2px 6px;
  border-radius: var(--radius-xs);
  font-size: var(--font-size-sm);
  font-family: 'Menlo', 'Consolas', monospace;
}

.markdown-body >>> .note-annotation {
  background: rgba(var(--warning-rgb), 0.08);
  border-left: 3px solid var(--warning-color);
  padding: 10px 14px;
  margin: 8px 0;
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  color: var(--text-primary);
}

.markdown-body >>> .annotation-label {
  display: inline-block;
  background: var(--warning-color);
  color: var(--text-primary);
  font-size: var(--font-size-caption2);
  font-weight: 600;
  padding: 1px 8px;
  border-radius: var(--radius-xs);
  margin-right: 8px;
  vertical-align: middle;
}

.markdown-body >>> .todo-item {
  list-style: none;
  margin-left: -20px;
  padding-left: 4px;
}

.markdown-body >>> .todo-checkbox {
  margin-right: 6px;
  cursor: pointer;
  accent-color: var(--primary-color);
  width: 16px;
  height: 16px;
  vertical-align: middle;
  position: relative;
}

.markdown-body >>> .todo-done {
  text-decoration: line-through;
  color: var(--text-tertiary);
}

.markdown-body >>> strong {
  font-weight: 600;
}

.markdown-body >>> del {
  color: var(--text-tertiary);
}

.cloud-panel {
  width: 600px;
  max-width: 90vw;
}

.cloud-panel-body {
  padding: 16px 20px;
  max-height: 60vh;
  overflow-y: auto;
}

.cloud-toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.cloud-note-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cloud-note-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
  transition: background 0.15s;
  gap: 12px;
}

.cloud-note-item:hover {
  background: var(--primary-light);
}

.cloud-note-info {
  flex: 1;
  min-width: 0;
}

.cloud-note-title {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cloud-note-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 4px;
  font-size: var(--font-size-caption2);
  color: var(--text-tertiary);
}

.cloud-note-folder,
.cloud-note-visibility,
.cloud-note-date {
  display: inline-flex;
  align-items: center;
}

.cloud-note-visibility.is-public {
  color: var(--success-color);
}

.cloud-note-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.cloud-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  border: none;
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: var(--font-size-sm);
  transition: background 0.15s, color 0.15s;
}

.cloud-action-btn:hover {
  background: var(--primary-light);
  color: var(--primary-color);
}

.cloud-action-btn:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.cloud-action-btn.danger:hover {
  background: rgba(var(--danger-rgb), 0.1);
  color: var(--danger-color);
}

.cloud-folder-select {
  height: 30px;
  padding: 0 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color);
  background: var(--card-bg);
  color: var(--text-primary);
  font-size: var(--font-size-caption);
  cursor: pointer;
  max-width: 100px;
}

.cloud-tabs {
  display: flex;
  gap: 0;
  margin-bottom: 16px;
  border-bottom: 2px solid var(--border-color);
}

.cloud-tab-btn {
  flex: 1;
  padding: 10px 16px;
  border: none;
  background: none;
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  font-weight: 500;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
}

.cloud-tab-btn.active {
  color: var(--primary-color);
  border-bottom-color: var(--primary-color);
}

.cloud-tab-btn:hover {
  color: var(--primary-color);
}

.public-note-item {
  cursor: pointer;
}

.cloud-note-author {
  display: inline-flex;
  align-items: center;
}

.cloud-note-fullscreen {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1000;
  background: var(--bg-color);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.cloud-note-fullscreen-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  border-bottom: 0.5px solid var(--separator-color);
  background: var(--card-bg);
  flex-shrink: 0;
}
.cloud-note-fullscreen-title {
  flex: 1;
  font-size: var(--font-size-subheadline);
  font-weight: 600;
  color: var(--text-primary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin: 0;
}
.cloud-note-fullscreen-meta {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 20px;
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
  border-bottom: 0.5px solid var(--separator-color);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.cloud-note-fullscreen-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  max-width: 800px;
  margin: 0 auto;
  width: 100%;
  line-height: 1.8;
  font-size: var(--font-size-body);
  color: var(--text-primary);
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

@media (max-width: 768px) {
  .notes-sidebar {
    position: fixed;
    top: 52px;
    left: 0;
    bottom: 0;
    z-index: 20;
    box-shadow: var(--shadow-md);
    width: 280px;
  }

  .preview-area {
    border-left: none;
  }

  .editor-content {
    flex: 1;
  }

  /* Tablet Mermaid improvements */
  .mermaid-chart {
    padding: 8px;
  }

  .mermaid-chart svg {
    min-width: 220px;
  }

  .mermaid-edit-btn,
  .mermaid-zoom-btn {
    width: 36px;
    height: 36px;
    font-size: var(--font-size-callout);
    opacity: 1;
  }

  .mermaid-chart-actions {
    opacity: 0.85;
    top: 4px;
    right: 4px;
    gap: 6px;
  }

  .mermaid-zoom-panel {
    width: 100vw;
    height: 100vh;
    max-width: 100vw;
    border-radius: 0;
  }

  .zoom-ctrl-btn {
    width: 36px;
    height: 36px;
    font-size: var(--font-size-callout);
  }

  .zoom-level {
    font-size: var(--font-size-sm);
    min-width: 54px;
  }

  .zoom-hint {
    font-size: var(--font-size-caption);
    padding: 8px 16px;
  }
}

@media (min-width: 1024px) and (orientation: landscape) {
  .notes-sidebar {
    width: 280px;
  }

  .sidebar-search {
    height: 44px;
    padding: 0 12px;
  }

  .sidebar-search-input {
    font-size: var(--font-size-base);
  }

  .file-item {
    padding: 12px 14px;
  }

  .file-item-title {
    font-size: var(--font-size-base);
  }

  .editor-toolbar {
    padding: 6px 16px;
  }

  .toolbar-btn {
    width: 44px;
    height: 44px;
    font-size: var(--font-size-sm);
  }

  .editor-textarea {
    line-height: 2;
    padding: 20px 24px;
  }

  .editor-resizer {
    width: 12px;
  }

  .chart-editor-body {
    flex-direction: column;
  }

  .chart-editor-visual {
    border-right: none;
    border-bottom: 0.5px solid var(--separator-color);
    min-height: 200px;
    max-height: 40vh;
  }

  .chart-editor-code {
    min-height: 150px;
  }

  .chart-tool-btn {
    min-width: 48px;
    height: 48px;
    font-size: var(--font-size-callout);
  }

  .mermaid-edit-btn,
  .mermaid-zoom-btn {
    width: 36px;
    height: 36px;
    font-size: var(--font-size-sm);
    opacity: 1;
  }

  .mermaid-chart-actions {
    opacity: 1;
  }

  .command-palette {
    width: 90vw;
  }

  .command-palette-item {
    padding: 14px 16px;
    font-size: var(--font-size-base);
  }

  .toolbar-btn {
    width: 44px;
    height: 44px;
    font-size: var(--font-size-sm);
  }

  .folder-select,
  .sort-select {
    height: 40px;
    font-size: var(--font-size-base);
  }

  .folder-add-btn {
    width: 40px;
    height: 40px;
  }

  .chart-code-textarea {
    font-size: var(--font-size-body);
    padding: 16px;
    line-height: 1.8;
  }

  .modal-panel {
    max-height: 95vh;
  }

  .btn-primary,
  .btn-secondary {
    min-height: 44px;
    padding: 10px 20px;
    font-size: var(--font-size-base);
  }
}
</style>
