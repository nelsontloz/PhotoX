Feature: Favorites

  Scenario: Favorites start empty
    Given I am signed in
    When I open "/favorites"
    Then the favorites page shows the empty state

  Scenario: Favoriting from the timeline then unfavoriting from the favorites viewer
    Given I am signed in
    And I uploaded "photo.jpg"
    When I click the photo thumbnail
    Then the viewer marks the asset as not a favorite
    When I click the favorite control in the viewer
    Then the viewer marks the asset as a favorite
    When I open "/favorites"
    Then the favorites grid shows exactly one item
    And the favorites thumbnail image finishes loading
    When I click the photo thumbnail
    Then the viewer marks the asset as a favorite
    When I click the favorite control in the viewer
    Then the favorites page shows the empty state

  Scenario: Favorited assets are grouped under their day
    Given I am signed in
    And I uploaded "photo.jpg"
    When I set the uploaded asset date for favorites grouping
    And I favorite the uploaded asset through the favorites API
    When I open "/favorites"
    Then the favorites grid shows exactly one item
    And the favorites grid groups the asset under the pinned date

  Scenario: Favorites are isolated between users
    Given I am signed in
    When I upload "photo.jpg" via the favorites API
    And I favorite the uploaded asset through the favorites API
    And another user registers for favorites isolation
    When the other user lists their favorites through the favorites API
    Then the other user's favorites list is empty
    When the other user uploads "photo-text.jpg" via the favorites API
    And the other user favorites their uploaded asset through the favorites API
    When the other user lists their favorites through the favorites API
    Then the other user's favorites list holds only their own asset

  Scenario: Favorites API pagination
    Given I am signed in
    When I upload "photo.jpg" via the favorites API
    And I favorite the uploaded asset through the favorites API
    When I upload "photo-text.jpg" via the favorites API
    And I favorite the uploaded asset through the favorites API
    When I list my favorites with limit 1 and offset 0
    Then the last favorites list holds 1 of 2 items
    When I list my favorites with limit 1 and offset 1
    Then the last favorites list holds 1 of 2 items
    And the favorites list pages hold my two distinct favorited assets

  Scenario: Unfavoriting through the API removes the asset from the favorites filter
    Given I am signed in
    When I upload "photo.jpg" via the favorites API
    And I favorite the uploaded asset through the favorites API
    When I unfavorite the uploaded asset through the favorites API
    And I list my favorites with limit 100 and offset 0
    Then the last favorites list holds 0 of 0 items

  Scenario: Another user cannot favorite my asset
    Given I am signed in
    When I upload "photo.jpg" via the favorites API
    And another user registers for favorites isolation
    When the other user tries to favorite my uploaded asset through the favorites API
    Then the response status is 404

  Scenario: Trashing a favorite removes it from the favorites filter
    Given I am signed in
    When I upload "photo.jpg" via the favorites API
    And I favorite the uploaded asset through the favorites API
    When I trash my uploaded asset through the favorites API
    Then the response status is 204
    When I list my favorites with limit 100 and offset 0
    Then the last favorites list holds 0 of 0 items
