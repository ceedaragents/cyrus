<context>
  <repository>{{repository_name}}</repository>
  <working_directory>{{working_directory}}</working_directory>
  <base_branch>{{base_branch}}</base_branch>
</context>

<linear_issue>
  <id>{{issue_id}}</id>
  <identifier>{{issue_identifier}}</identifier>
  <title>{{issue_title}}</title>
  <description>
{{issue_description}}
  </description>
  <state>{{issue_state}}</state>
  <priority>{{issue_priority}}</priority>
  <url>{{issue_url}}</url>
  <assignee>
    <name>{{assignee_name}}</name>
    <github_username>{{assignee_github_username}}</github_username>
  </assignee>
</linear_issue>

<linear_comments>
{{comment_threads}}
</linear_comments>

{{#if new_comment}}
<new_comment_to_address>
  <author>{{new_comment_author}}</author>
  <timestamp>{{new_comment_timestamp}}</timestamp>
  <content>
{{new_comment_content}}
  </content>
</new_comment_to_address>

IMPORTANT: Focus specifically on addressing the new comment above. This is a new request that requires your attention.
{{/if}}