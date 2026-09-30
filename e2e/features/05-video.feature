@slow
Feature: Uploading videos makes them playable

  Scenario: A non-h264 video is transcoded and plays
    Given I am signed in
    When I upload "video-vp8.webm"
    Then the timeline shows exactly one item
    And the video asset reaches transcode status "ready" with a transcode file
    And the timeline shows its loaded thumbnail
    When I open the video viewer for that asset
    Then the video element becomes playable
    And playback advances past 0.2 seconds

  Scenario: An h264+aac video skips transcoding and plays the original
    Given I am signed in
    When I upload "video-h264.mp4"
    Then the timeline shows exactly one item
    And the video asset reaches transcode status "ready" without a transcode file
    And the timeline shows its loaded thumbnail
    When I open the video viewer for that asset
    Then the video element becomes playable
    And playback advances past 0.2 seconds
